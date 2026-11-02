package com.fabioara.um;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewAssetLoader;

import java.util.Locale;

/**
 * Native shell for the Um web app.
 *
 * Structural reference: AraLearn's WebView shell (MIT License). Only the asset
 * loading, window-inset, lifecycle and safe-navigation patterns are reused.
 * No AraLearn course flows, JSON export, signing or branding are copied.
 *
 * The JavaScript bridge is intentionally absent. The web app exposes
 * window.UmAndroid itself; no native JavascriptInterface is registered here.
 */
public class MainActivity extends ComponentActivity {
    private static final String APP_URL =
        "https://appassets.androidplatform.net/assets/www/index.html";
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String APP_PORT = "443";
    private static final String INTERNAL_PATH_PREFIX = "/assets/www/";
    private static final String ASSET_PATH_PREFIX = "/assets/";
    private static final String JAVASCRIPT_MIME_TYPE = "text/javascript";

    private static final String BACK_SCRIPT =
        "(function(){try{return !!(window.UmAndroid && window.UmAndroid.back && " +
        "window.UmAndroid.back());}catch(_error){return false;}})();";
    private static final String FLUSH_SCRIPT =
        "(function(){try{if(window.UmAndroid&&window.UmAndroid.flush){" +
        "Promise.resolve(window.UmAndroid.flush()).catch(function(){});" +
        "return true;}}catch(_error){}return false;})();";

    private WebView webView;
    private WebViewAssetLoader assetLoader;

    /**
     * Serves packaged files under /assets/ and forces JavaScript MIME types so
     * ES modules (.mjs) and plain .js files both load from the asset loader.
     */
    private static final class AssetPathHandler implements WebViewAssetLoader.PathHandler {
        private final WebViewAssetLoader.AssetsPathHandler delegate;

        AssetPathHandler(Context context) {
            delegate = new WebViewAssetLoader.AssetsPathHandler(context);
        }

        @Override
        public WebResourceResponse handle(String path) {
            WebResourceResponse response = delegate.handle(path);
            if (response != null && isJavaScriptPath(path)) {
                response.setMimeType(JAVASCRIPT_MIME_TYPE);
            }
            return response;
        }

        private static boolean isJavaScriptPath(String path) {
            if (path == null) return false;
            String lower = path.toLowerCase(Locale.ROOT);
            return lower.endsWith(".mjs") || lower.endsWith(".js");
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        setContentView(R.layout.activity_main);
        configureWindowInsets();

        webView = findViewById(R.id.main_webview);
        assetLoader = new WebViewAssetLoader.Builder()
            .addPathHandler(ASSET_PATH_PREFIX, new AssetPathHandler(this))
            .build();

        configureWebView();
        configureBackNavigation();
        WebView.setWebContentsDebuggingEnabled(isDebuggableApp());

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(APP_URL);
        }
    }

    /**
     * Applies system bar and cutout insets as container padding and consumes
     * those types so CSS safe areas are not doubled. IME insets are left
     * untouched and flow through to the WebView.
     */
    private void configureWindowInsets() {
        View container = findViewById(R.id.main_container);
        ViewCompat.setOnApplyWindowInsetsListener(container, (view, windowInsets) -> {
            int types = WindowInsetsCompat.Type.systemBars()
                | WindowInsetsCompat.Type.displayCutout();
            Insets safeArea = windowInsets.getInsets(types);
            view.setPadding(safeArea.left, safeArea.top, safeArea.right, safeArea.bottom);
            return new WindowInsetsCompat.Builder(windowInsets)
                .setInsets(types, Insets.NONE)
                .build();
        });
        ViewCompat.requestApplyInsets(container);
    }

    @SuppressLint({"SetJavaScriptEnabled"})
    @SuppressWarnings("deprecation")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(
            isDebuggableApp()
                ? WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                : WebSettings.MIXED_CONTENT_NEVER_ALLOW
        );

        // No addJavascriptInterface: window.UmAndroid belongs to the web app.
        webView.setWebViewClient(new AppWebViewClient());
    }

    private void configureBackNavigation() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView view = webView;
                if (view == null) {
                    finish();
                    return;
                }
                view.evaluateJavascript(BACK_SCRIPT, value -> {
                    if ("true".equals(value)) return;
                    if (view.canGoBack()) {
                        view.goBack();
                    } else {
                        finish();
                    }
                });
            }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
    }

    @Override
    protected void onPause() {
        WebView view = webView;
        if (view != null) {
            // Ask the web app to persist pending work, then pause only this view.
            view.evaluateJavascript(FLUSH_SCRIPT, null);
            view.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) {
            webView.saveState(outState);
        }
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        WebView view = webView;
        webView = null;
        assetLoader = null;
        if (view != null) {
            view.stopLoading();
            view.setWebViewClient(null);
            view.setWebChromeClient(null);
            view.destroy();
        }
        super.onDestroy();
    }

    private boolean isDebuggableApp() {
        return (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private boolean isInternalUrl(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())) return false;
        if (!APP_HOST.equalsIgnoreCase(uri.getHost())) return false;
        if (uri.getUserInfo() != null) return false;
        String port = uri.getPort() == -1 ? APP_PORT : String.valueOf(uri.getPort());
        if (!APP_PORT.equals(port)) return false;
        String path = uri.getPath();
        return path != null && path.startsWith(INTERNAL_PATH_PREFIX);
    }

    private static boolean isExternalScheme(Uri uri) {
        String scheme = uri == null ? null : uri.getScheme();
        return "https".equalsIgnoreCase(scheme)
            || "http".equalsIgnoreCase(scheme)
            || "mailto".equalsIgnoreCase(scheme)
            || "tel".equalsIgnoreCase(scheme);
    }

    private static boolean hasUserGesture(WebResourceRequest request) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && request.hasGesture();
    }

    private void openExternalUrl(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            // No matching app installed; leave the WebView where it is.
        }
    }

    private final class AppWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();

            if (isInternalUrl(uri)) {
                return false;
            }

            // External destinations open outside the WebView only for top-level,
            // user-initiated navigation. Subframes, scripts, data/blob/file and
            // content URLs are blocked.
            if (
                request.isForMainFrame() &&
                hasUserGesture(request) &&
                isExternalScheme(uri)
            ) {
                openExternalUrl(uri);
            }
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(
            WebView view,
            WebResourceRequest request
        ) {
            // Only appassets:// is served locally; external fetch/API requests
            // fall through to the network untouched.
            return assetLoader == null
                ? null
                : assetLoader.shouldInterceptRequest(request.getUrl());
        }
    }
}
