package com.tinkeringdad.plaintv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.media.tv.TvContract;
import android.media.tv.TvInputInfo;
import android.media.tv.TvInputManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/** The home screen: a search bar, a few shortcuts and your apps. Nothing else. */
public class HomeActivity extends Activity {

    private GridView grid;
    private final List<AppEntry> apps = new ArrayList<>();
    private AppsAdapter adapter;
    private boolean longPressHandled;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_home);
        grid = findViewById(R.id.grid);
        adapter = new AppsAdapter();
        grid.setAdapter(adapter);
        grid.setOnItemClickListener((p, v, pos, id) -> launch(apps.get(pos)));
        grid.setOnItemLongClickListener((p, v, pos, id) -> { showOptions(pos); return true; });
        grid.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            View last;
            @Override public void onItemSelected(AdapterView<?> p, View v, int pos, long id) {
                if (last != null) last.animate().scaleX(1f).scaleY(1f).setDuration(120).start();
                if (v != null) v.animate().scaleX(1.06f).scaleY(1.06f).setDuration(120).start();
                last = v;
            }
            @Override public void onNothingSelected(AdapterView<?> p) {
                if (last != null) last.animate().scaleX(1f).scaleY(1f).setDuration(120).start();
                last = null;
            }
        });

        findViewById(R.id.search).setOnClickListener(v -> openSearch(false));
        findViewById(R.id.tvsettings).setOnClickListener(v -> start(new Intent(Settings.ACTION_SETTINGS)));
        findViewById(R.id.setup).setOnClickListener(v -> start(new Intent(this, SetupActivity.class)));
        findViewById(R.id.inputs).setOnClickListener(v -> showInputs());
    }

    @Override
    protected void onResume() {
        super.onResume();
        reload();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // Home pressed while already home: go back to the first app.
        if (!apps.isEmpty()) {
            grid.setSelection(0);
            grid.requestFocus();
        }
    }

    @Override
    public void onBackPressed() {
        // Home has nowhere to go back to.
    }

    private void reload() {
        int sel = grid.getSelectedItemPosition();
        apps.clear();
        apps.addAll(AppEntry.load(this, false));
        adapter.notifyDataSetChanged();
        if (sel >= 0 && sel < apps.size()) grid.setSelection(sel);
        if (!grid.hasFocus() && getCurrentFocus() == null) grid.requestFocus();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        boolean select = k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER
                || k == KeyEvent.KEYCODE_NUMPAD_ENTER;
        if (grid.hasFocus() && select) {
            // Hold the select button to move or hide an app. Works on every remote.
            if (e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 0) longPressHandled = false;
            if (e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() > 0) {
                if (!longPressHandled) {
                    longPressHandled = true;
                    showOptions(grid.getSelectedItemPosition());
                }
                return true;
            }
            if (e.getAction() == KeyEvent.ACTION_UP && longPressHandled) {
                longPressHandled = false;
                return true;
            }
        }
        if (e.getAction() == KeyEvent.ACTION_UP && k == KeyEvent.KEYCODE_MENU && grid.hasFocus()) {
            showOptions(grid.getSelectedItemPosition());
            return true;
        }
        if (e.getAction() == KeyEvent.ACTION_UP
                && (k == KeyEvent.KEYCODE_SEARCH || k == KeyEvent.KEYCODE_ASSIST || k == KeyEvent.KEYCODE_VOICE_ASSIST)) {
            openSearch(k != KeyEvent.KEYCODE_SEARCH);
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    @Override
    public boolean onSearchRequested() {
        openSearch(false);
        return true;
    }

    private void openSearch(boolean voice) {
        Intent i = new Intent(this, SearchActivity.class);
        i.putExtra(SearchActivity.EXTRA_VOICE, voice);
        start(i);
    }

    private void launch(AppEntry a) {
        try {
            startActivity(a.launchIntent());
        } catch (Exception ex) {
            Toast.makeText(this, "Couldn't open " + a.label, Toast.LENGTH_SHORT).show();
        }
    }

    private void start(Intent i) {
        try {
            startActivity(i);
        } catch (ActivityNotFoundException ex) {
            Toast.makeText(this, "This TV doesn't have that screen", Toast.LENGTH_SHORT).show();
        }
    }

    private void showOptions(int pos) {
        if (pos < 0 || pos >= apps.size()) return;
        AppEntry a = apps.get(pos);
        String[] items = {"Move to the start", "Move left", "Move right", "Move up a row", "Move down a row",
                "Hide from home", "App info"};
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(a.label)
                .setItems(items, (d, which) -> {
                    int cols = Math.max(1, grid.getNumColumns());
                    switch (which) {
                        case 0: move(pos, 0); break;
                        case 1: move(pos, pos - 1); break;
                        case 2: move(pos, pos + 1); break;
                        case 3: move(pos, pos - cols); break;
                        case 4: move(pos, pos + cols); break;
                        case 5: hide(a); break;
                        case 6:
                            start(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                    Uri.fromParts("package", a.component.getPackageName(), null)));
                            break;
                    }
                })
                .show();
    }

    private void move(int from, int to) {
        to = Math.max(0, Math.min(apps.size() - 1, to));
        if (from == to) return;
        AppEntry a = apps.remove(from);
        apps.add(to, a);
        saveOrder();
        adapter.notifyDataSetChanged();
        grid.setSelection(to);
    }

    private void hide(AppEntry a) {
        Set<String> h = Prefs.hidden(this);
        h.add(a.key());
        Prefs.setHidden(this, h);
        Toast.makeText(this, a.label + " hidden. Show it again from Plain TV settings.", Toast.LENGTH_LONG).show();
        reload();
    }

    private void saveOrder() {
        // Keep hidden apps' places too, so unhiding puts them back where they were.
        List<String> order = new ArrayList<>();
        for (AppEntry e : apps) order.add(e.key());
        for (String k : Prefs.order(this)) if (!order.contains(k)) order.add(k);
        Prefs.setOrder(this, order);
    }

    /** HDMI and other inputs, opened through the TV's own live-TV app. */
    private void showInputs() {
        TvInputManager tim = (TvInputManager) getSystemService(Context.TV_INPUT_SERVICE);
        List<TvInputInfo> list = new ArrayList<>();
        if (tim != null) {
            try {
                for (TvInputInfo info : tim.getTvInputList()) {
                    if (info.isPassthroughInput() && !info.isHidden(this)) list.add(info);
                }
            } catch (Exception ignored) { }
        }
        if (list.isEmpty()) {
            Toast.makeText(this, "No inputs found. Try TV settings, then Inputs.", Toast.LENGTH_LONG).show();
            return;
        }
        String[] names = new String[list.size()];
        for (int i = 0; i < list.size(); i++) {
            CharSequence custom = list.get(i).loadCustomLabel(this);
            names[i] = String.valueOf(custom != null && custom.length() > 0 ? custom : list.get(i).loadLabel(this));
        }
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("Inputs")
                .setItems(names, (d, which) -> {
                    Uri uri = TvContract.buildChannelUriForPassthroughInput(list.get(which).getId());
                    Intent i = new Intent(Intent.ACTION_VIEW, uri);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    start(i);
                })
                .show();
    }

    private class AppsAdapter extends BaseAdapter {
        @Override public int getCount() { return apps.size(); }
        @Override public Object getItem(int p) { return apps.get(p); }
        @Override public long getItemId(int p) { return apps.get(p).key().hashCode(); }
        @Override public boolean hasStableIds() { return true; }

        @Override
        public View getView(int pos, View v, ViewGroup parent) {
            if (v == null) v = LayoutInflater.from(HomeActivity.this).inflate(R.layout.item_app, parent, false);
            AppEntry a = apps.get(pos);
            ImageView banner = v.findViewById(R.id.banner);
            View iconBox = v.findViewById(R.id.iconbox);
            TextView label = v.findViewById(R.id.label);
            label.setText(a.label);
            if (a.banner != null) {
                banner.setVisibility(View.VISIBLE);
                banner.setImageDrawable(a.banner);
                iconBox.setVisibility(View.GONE);
            } else {
                banner.setVisibility(View.GONE);
                iconBox.setVisibility(View.VISIBLE);
                ((ImageView) v.findViewById(R.id.icon)).setImageDrawable(a.icon);
            }
            return v;
        }
    }
}
