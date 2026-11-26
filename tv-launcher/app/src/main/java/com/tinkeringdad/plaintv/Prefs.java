package com.tinkeringdad.plaintv;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Small wrapper around the app's saved settings. */
final class Prefs {
    private static final String FILE = "plain";
    static final String REPLACE_HOME = "replace_home";
    static final String REMAP_ASSIST = "remap_assist";

    private Prefs() {}

    static SharedPreferences get(Context c) {
        return c.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    static boolean replaceHome(Context c) { return get(c).getBoolean(REPLACE_HOME, true); }
    static boolean remapAssist(Context c) { return get(c).getBoolean(REMAP_ASSIST, true); }

    /** App order, as flattened component names. */
    static List<String> order(Context c) {
        String s = get(c).getString("order", "");
        List<String> out = new ArrayList<>();
        if (!s.isEmpty()) out.addAll(Arrays.asList(s.split(";")));
        return out;
    }

    static void setOrder(Context c, List<String> order) {
        get(c).edit().putString("order", String.join(";", order)).apply();
    }

    static Set<String> hidden(Context c) {
        return new HashSet<>(get(c).getStringSet("hidden", new HashSet<>()));
    }

    static void setHidden(Context c, Set<String> hidden) {
        get(c).edit().putStringSet("hidden", hidden).apply();
    }
}
