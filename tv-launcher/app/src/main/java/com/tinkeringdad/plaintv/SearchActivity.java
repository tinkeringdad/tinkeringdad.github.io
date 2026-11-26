package com.tinkeringdad.plaintv;

import android.app.Activity;
import android.app.SearchManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.KeyEvent;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.BaseAdapter;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Plain search: type or speak, then pick where to look. Results are your installed
 * apps and "search in <app>" for apps that accept a search. No assistant, no chat.
 */
public class SearchActivity extends Activity {
    static final String EXTRA_VOICE = "voice";
    private static final int REQ_VOICE = 1;

    private static final String YOUTUBE = "com.google.android.youtube.tv";
    /** Never hand a search to these: they are the Google app / Gemini / assistant. */
    private static final Set<String> SKIP = new HashSet<>();
    static {
        SKIP.add("com.google.android.googlequicksearchbox");
        SKIP.add("com.google.android.katniss");
        SKIP.add("com.google.android.apps.bard");
        SKIP.add("com.google.android.apps.tv.launcherx");
        SKIP.add("com.google.android.tvlauncher");
    }

    private EditText query;
    private TextView status;
    private ListView list;
    private final List<Result> results = new ArrayList<>();
    private ResultsAdapter adapter;
    private List<AppEntry> apps;
    private boolean voiceAvailable;

    private static final class Result {
        final String text;
        final Drawable icon;
        final Intent intent;
        Result(String text, Drawable icon, Intent intent) { this.text = text; this.icon = icon; this.intent = intent; }
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_search);
        query = findViewById(R.id.query);
        status = findViewById(R.id.status);
        list = findViewById(R.id.results);
        adapter = new ResultsAdapter();
        list.setAdapter(adapter);
        list.setOnItemClickListener((p, v, pos, id) -> open(results.get(pos)));
        apps = AppEntry.load(this, true);

        View mic = findViewById(R.id.mic);
        voiceAvailable = !getPackageManager().queryIntentActivities(voiceIntent(), 0).isEmpty();
        mic.setVisibility(voiceAvailable ? View.VISIBLE : View.GONE);
        mic.setOnClickListener(v -> startVoice());

        query.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void afterTextChanged(Editable s) { update(); }
        });
        query.setOnEditorActionListener((v, actionId, e) -> {
            boolean go = actionId == EditorInfo.IME_ACTION_SEARCH || actionId == EditorInfo.IME_ACTION_DONE
                    || (e != null && e.getKeyCode() == KeyEvent.KEYCODE_ENTER);
            if (go) {
                hideKeyboard();
                if (!results.isEmpty()) {
                    list.requestFocus();
                    list.setSelection(0);
                }
                return true;
            }
            return false;
        });

        handle(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handle(intent);
    }

    private void handle(Intent intent) {
        boolean voice = intent.getBooleanExtra(EXTRA_VOICE, false)
                || Intent.ACTION_ASSIST.equals(intent.getAction())
                || Intent.ACTION_SEARCH_LONG_PRESS.equals(intent.getAction());
        if (voice && voiceAvailable) {
            startVoice();
        } else {
            query.requestFocus();
            query.post(() -> {
                InputMethodManager imm = getSystemService(InputMethodManager.class);
                if (imm != null) imm.showSoftInput(query, InputMethodManager.SHOW_IMPLICIT);
            });
        }
    }

    private Intent voiceIntent() {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_WEB_SEARCH);
        i.putExtra(RecognizerIntent.EXTRA_PROMPT, "Say what to search for");
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        // Pick the TV's own voice typing screen directly rather than asking every time.
        List<ResolveInfo> handlers = getPackageManager().queryIntentActivities(i, 0);
        ResolveInfo pick = null;
        for (ResolveInfo ri : handlers) {
            if ("com.google.android.katniss".equals(ri.activityInfo.packageName)) { pick = ri; break; }
        }
        if (pick == null && handlers.size() == 1) pick = handlers.get(0);
        if (pick != null) i.setClassName(pick.activityInfo.packageName, pick.activityInfo.name);
        return i;
    }

    private void startVoice() {
        Diag.voicePending = true;
        Diag.voiceChangedAt = android.os.SystemClock.elapsedRealtime();
        try {
            startActivityForResult(voiceIntent(), REQ_VOICE);
        } catch (ActivityNotFoundException e) {
            Diag.voicePending = false;
            Toast.makeText(this, "Voice input isn't available. Type instead.", Toast.LENGTH_SHORT).show();
            query.requestFocus();
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != REQ_VOICE) return;
        Diag.voicePending = false;
        Diag.voiceChangedAt = android.os.SystemClock.elapsedRealtime();
        if (res == RESULT_OK && data != null) {
            ArrayList<String> heard = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (heard != null && !heard.isEmpty()) {
                query.setText(heard.get(0));
                query.setSelection(query.length());
                if (!results.isEmpty()) {
                    list.requestFocus();
                    list.setSelection(0);
                }
                return;
            }
        }
        query.requestFocus();
    }

    private void update() {
        String q = query.getText().toString().trim();
        results.clear();
        if (q.isEmpty()) {
            status.setText("Type or speak. Results are your apps and the apps that can search, nothing else.");
            adapter.notifyDataSetChanged();
            return;
        }
        PackageManager pm = getPackageManager();

        // 1. Your apps whose name matches.
        for (AppEntry a : apps) {
            if (a.matches(q)) results.add(new Result("Open " + a.label, a.icon, a.launchIntent()));
        }

        Set<String> done = new HashSet<>();
        // 2. YouTube, which most people want first.
        AppEntry yt = find(YOUTUBE);
        if (yt != null) {
            Intent i = new Intent(Intent.ACTION_SEARCH).setPackage(YOUTUBE)
                    .putExtra(SearchManager.QUERY, q).putExtra("query", q);
            if (i.resolveActivity(pm) == null) {
                i = new Intent(Intent.ACTION_VIEW,
                        Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(q))).setPackage(YOUTUBE);
            }
            results.add(new Result("Search YouTube for “" + q + "”", yt.icon, i));
            done.add(YOUTUBE);
        }

        // 3. Every other installed app that says it accepts a search.
        for (ResolveInfo ri : pm.queryIntentActivities(new Intent(Intent.ACTION_SEARCH), 0)) {
            String pkg = ri.activityInfo.packageName;
            if (done.contains(pkg) || SKIP.contains(pkg) || pkg.equals(getPackageName())) continue;
            AppEntry app = find(pkg);
            if (app == null) continue; // only apps you can actually see on the TV
            done.add(pkg);
            Intent i = new Intent(Intent.ACTION_SEARCH)
                    .setClassName(pkg, ri.activityInfo.name)
                    .putExtra(SearchManager.QUERY, q).putExtra("query", q);
            results.add(new Result("Search " + app.label + " for “" + q + "”", app.icon, i));
        }

        // 4. The web, if there is a browser that isn't the Google app.
        Intent web = new Intent(Intent.ACTION_VIEW, Uri.parse("https://duckduckgo.com/?q=" + Uri.encode(q)));
        ResolveInfo wr = pm.resolveActivity(web, 0);
        if (wr != null && wr.activityInfo != null && !"android".equals(wr.activityInfo.packageName)
                && !SKIP.contains(wr.activityInfo.packageName)) {
            results.add(new Result("Search the web for “" + q + "”", wr.loadIcon(pm), web));
        }

        status.setText(results.isEmpty() ? "Nothing on this TV matches “" + q + "”." : "Press down to choose.");
        adapter.notifyDataSetChanged();
    }

    private AppEntry find(String pkg) {
        for (AppEntry a : apps) if (a.component.getPackageName().equals(pkg)) return a;
        return null;
    }

    private void open(Result r) {
        try {
            Intent i = new Intent(r.intent).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, "That app didn't accept the search.", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        Diag.voicePending = false;
    }

    private void hideKeyboard() {
        InputMethodManager imm = getSystemService(InputMethodManager.class);
        if (imm != null) imm.hideSoftInputFromWindow(query.getWindowToken(), 0);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        // The remote's mic / search button, if it reaches us, starts voice input here.
        if (k == KeyEvent.KEYCODE_SEARCH || k == KeyEvent.KEYCODE_ASSIST || k == KeyEvent.KEYCODE_VOICE_ASSIST) {
            if (e.getAction() == KeyEvent.ACTION_UP && voiceAvailable) startVoice();
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    private class ResultsAdapter extends BaseAdapter {
        @Override public int getCount() { return results.size(); }
        @Override public Object getItem(int p) { return results.get(p); }
        @Override public long getItemId(int p) { return p; }

        @Override
        public View getView(int pos, View v, ViewGroup parent) {
            if (v == null) v = LayoutInflater.from(SearchActivity.this).inflate(R.layout.item_result, parent, false);
            Result r = results.get(pos);
            ((TextView) v.findViewById(R.id.text)).setText(r.text);
            ((ImageView) v.findViewById(R.id.icon)).setImageDrawable(r.icon);
            return v;
        }
    }
}
