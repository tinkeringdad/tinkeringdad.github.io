package com.tinkeringdad.plaintv;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

import java.util.HashSet;
import java.util.Set;

/**
 * Optional helper, switched on in the TV's accessibility settings.
 *
 * Google TV doesn't let you pick a different home app, so when the Google TV home
 * screen opens this brings Plain TV to the front instead. It also catches the
 * remote's Assistant / search keys and opens Plain search rather than Gemini.
 * It reads only which app's window opened and the remote's key codes.
 */
public class RemoteButtonService extends AccessibilityService {

    /** Google's TV home screens across Google TV and Android TV versions. */
    private static final Set<String> STOCK_HOMES = new HashSet<>();
    static {
        STOCK_HOMES.add("com.google.android.apps.tv.launcherx");
        STOCK_HOMES.add("com.google.android.tvlauncher");
        STOCK_HOMES.add("com.google.android.leanbacklauncher");
    }

    /**
     * Where the assistant / Gemini overlay lives. The voice-typing screen that Plain
     * search asks for comes from the same place, so that case is let through.
     */
    private static final Set<String> ASSISTANTS = new HashSet<>();
    static {
        ASSISTANTS.add("com.google.android.katniss");
        ASSISTANTS.add("com.google.android.apps.bard");
        ASSISTANTS.add("com.google.android.googlequicksearchbox");
    }

    private final Handler handler = new Handler(Looper.getMainLooper());
    private long lastRedirect;
    private long lastAssistRedirect;

    /** Some remotes' Assistant button never reaches apps, so catch the overlay instead. */
    private void onAssistantOpened() {
        if (!Prefs.remapAssist(this)) return;
        long now = SystemClock.elapsedRealtime();
        if (Diag.voiceBusy(now)) return; // Plain search asked for voice typing
        if (now - lastAssistRedirect < 2000) return;
        lastAssistRedirect = now;
        performGlobalAction(GLOBAL_ACTION_BACK);
        handler.postDelayed(this::openSearch, 350);
    }

    private void openSearch() {
        Intent i = new Intent(this, SearchActivity.class);
        i.putExtra(SearchActivity.EXTRA_VOICE, true);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(i);
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        // Right after the TV starts, Google TV home is already showing before this
        // helper is running, so no "window opened" event arrives. Take over once.
        if (Prefs.replaceHome(this) && SystemClock.elapsedRealtime() < 5 * 60 * 1000) goHome();
    }

    private void goHome() {
        lastRedirect = SystemClock.uptimeMillis();
        Intent i = new Intent(this, HomeActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION);
        startActivity(i);
    }

    static boolean isAssistKey(int k) {
        return k == KeyEvent.KEYCODE_SEARCH || k == KeyEvent.KEYCODE_ASSIST || k == KeyEvent.KEYCODE_VOICE_ASSIST;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        CharSequence pkg = e.getPackageName();
        if (pkg == null) return;
        String p = pkg.toString();
        Diag.window(p);
        if (ASSISTANTS.contains(p)) {
            CharSequence cls = e.getClassName();
            boolean voiceTyping = cls != null && cls.toString().toLowerCase().contains("voiceinput");
            if (!voiceTyping) onAssistantOpened();
            return;
        }
        if (!STOCK_HOMES.contains(p)) return;
        // Let Google TV's "who's watching" profile picker through.
        CharSequence cls = e.getClassName();
        if (cls != null && cls.toString().toLowerCase().contains("profile")) return;
        if (!Prefs.replaceHome(this)) return;
        long now = SystemClock.uptimeMillis();
        if (now - lastRedirect < 700) return;
        goHome();
    }

    @Override
    protected boolean onKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        if (e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 0 && !isDpad(k)) {
            Diag.key(KeyEvent.keyCodeToString(k) + " (" + k + ")");
        }
        if (!isAssistKey(k) || !Prefs.remapAssist(this)) return false;
        if (e.getAction() == KeyEvent.ACTION_UP) openSearch();
        return true; // swallow both down and up so the assistant never sees it
    }

    private static boolean isDpad(int k) {
        return k == KeyEvent.KEYCODE_DPAD_UP || k == KeyEvent.KEYCODE_DPAD_DOWN
                || k == KeyEvent.KEYCODE_DPAD_LEFT || k == KeyEvent.KEYCODE_DPAD_RIGHT
                || k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER;
    }

    @Override
    public void onInterrupt() { }
}
