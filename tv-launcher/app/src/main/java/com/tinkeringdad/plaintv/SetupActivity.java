package com.tinkeringdad.plaintv;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import java.util.Set;

/** Settings for Plain TV: the remote-button helper and hidden apps. */
public class SetupActivity extends Activity {

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_setup);

        Switch home = findViewById(R.id.swHome);
        home.setChecked(Prefs.replaceHome(this));
        home.setOnCheckedChangeListener((b, on) ->
                Prefs.get(this).edit().putBoolean(Prefs.REPLACE_HOME, on).apply());

        Switch assist = findViewById(R.id.swAssist);
        assist.setChecked(Prefs.remapAssist(this));
        assist.setOnCheckedChangeListener((b, on) ->
                Prefs.get(this).edit().putBoolean(Prefs.REMAP_ASSIST, on).apply());

        findViewById(R.id.openA11y).setOnClickListener(v -> {
            try {
                startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            } catch (ActivityNotFoundException e) {
                Toast.makeText(this, "Open TV settings, then System, then Accessibility", Toast.LENGTH_LONG).show();
            }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        boolean on = serviceEnabled();
        ((TextView) findViewById(R.id.status)).setText(on
                ? "The remote-button helper is on. Home and the Assistant button come here."
                : "The remote-button helper is off, so the Home button still opens Google TV. "
                  + "Turn on “" + getString(R.string.service_name) + "” in accessibility settings. "
                  + "If it's greyed out, see the install notes.");
        ((TextView) findViewById(R.id.lastKey)).setText(Diag.summary());
        fillHidden();
    }

    private boolean serviceEnabled() {
        String list = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (TextUtils.isEmpty(list)) return false;
        ComponentName me = new ComponentName(this, RemoteButtonService.class);
        for (String s : list.split(":")) {
            ComponentName c = ComponentName.unflattenFromString(s);
            if (me.equals(c)) return true;
        }
        return false;
    }

    private void fillHidden() {
        LinearLayout box = findViewById(R.id.hiddenList);
        box.removeAllViews();
        Set<String> hidden = Prefs.hidden(this);
        int count = 0;
        for (AppEntry a : AppEntry.load(this, true)) {
            if (!hidden.contains(a.key())) continue;
            count++;
            TextView row = new TextView(this);
            row.setText("Show " + a.label);
            row.setTextSize(TypedValue.COMPLEX_UNIT_SP, 19);
            row.setTextColor(getColor(R.color.text));
            row.setBackgroundResource(R.drawable.row_selector);
            int pad = dp(18);
            row.setPadding(pad, dp(12), pad, dp(12));
            row.setFocusable(true);
            row.setClickable(true);
            row.setOnClickListener(v -> {
                Set<String> h = Prefs.hidden(this);
                h.remove(a.key());
                Prefs.setHidden(this, h);
                fillHidden();
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.topMargin = dp(8);
            box.addView(row, lp);
        }
        if (count == 0) {
            TextView none = new TextView(this);
            none.setText("No hidden apps.");
            none.setTextColor(getColor(R.color.muted));
            none.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            box.addView(none);
        }
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density);
    }
}
