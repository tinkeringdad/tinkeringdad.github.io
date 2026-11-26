package com.tinkeringdad.plaintv;

import android.content.Context;
import android.util.AttributeSet;
import android.widget.FrameLayout;

/** A FrameLayout that keeps the 16:9 shape of a TV app banner. */
public class BannerFrame extends FrameLayout {
    public BannerFrame(Context c) { super(c); }
    public BannerFrame(Context c, AttributeSet a) { super(c, a); }

    @Override
    protected void onMeasure(int widthSpec, int heightSpec) {
        int w = MeasureSpec.getSize(widthSpec);
        int h = w * 9 / 16;
        super.onMeasure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY),
                MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY));
    }
}
