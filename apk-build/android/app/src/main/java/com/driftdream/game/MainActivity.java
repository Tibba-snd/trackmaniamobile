package com.driftdream.game;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.WindowInsetsController;
import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Immersive sticky fullscreen:
     *   - Hide both status + nav bars on launch.
     *   - When the user swipes to reveal them, they appear transiently (BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE)
     *     and the system re-hides them automatically — they never *stay* visible, so the canvas
     *     never permanently loses a strip.
     *
     * The launch theme (AppTheme.NoActionBarLaunch) already sets windowFullscreen; this re-asserts
     * it at onResume time and after every config change (keyboard/something popping the bars back).
     */
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyImmersive();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyImmersive();
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // Capacitor's WebView steals focus oddly on cold start; onWindowFocusChanged alone
        // leaves the status bar visible on the first frame on some ROMs. Re-assert here and
        // on the decor view's next layout pass so the hide always lands.
        applyImmersive();
        getWindow().getDecorView().post(this::applyImmersive);
    }

    private void applyImmersive() {
        Window window = getWindow();
        if (window == null) return;

        // CRITICAL: draw the WebView *behind* the system bars. Without this, on API 30+ the
        // WebView is inset away from the top/left edges, exposing the window background
        // (a coloured strip) — and the game's CSS never reaches the screen edges. This single
        // line is what makes "the blur extends all the way" and "no white bar" both true.
        WindowCompat.setDecorFitsSystemWindows(window, false);

        // Keep the screen on at the native layer as a belt-and-suspenders alongside the Web wake-lock.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            // Pre-API-30 legacy immersive sticky.
            int flags = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
            View decor = window.getDecorView();
            decor.setSystemUiVisibility(flags);
        }
    }
}
