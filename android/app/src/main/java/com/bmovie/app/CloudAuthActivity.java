package com.bmovie.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

public class CloudAuthActivity extends AppCompatActivity {
    public static final String EXTRA_PROVIDER = "provider";
    public static final String RESULT_CREDENTIAL = "credential";
    public static final String RESULT_CREDENTIAL_TYPE = "credentialType";

    private static final String PROVIDER_QUARK = "quark";
    private static final String PROVIDER_BAIDU = "baidu";
    private static final String PROVIDER_ALIYUN = "aliyun";
    private static final String PROVIDER_BILIBILI = "bilibili";
    private static final String PROVIDER_NETEASE = "netease";

    private WebView webView;
    private TextView statusView;
    private ProgressBar progressView;
    private String provider;
    private boolean completed;

    public static boolean isSupportedProvider(String provider) {
        return PROVIDER_QUARK.equals(provider) || PROVIDER_BAIDU.equals(provider) || PROVIDER_ALIYUN.equals(provider) || PROVIDER_BILIBILI.equals(provider) || PROVIDER_NETEASE.equals(provider);
    }

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        provider = getIntent().getStringExtra(EXTRA_PROVIDER);
        if (!isSupportedProvider(provider)) {
            finish();
            return;
        }
        buildUi();
        configureWebView();
        if (PROVIDER_QUARK.equals(provider)) {
            statusView.setText("请登录夸克网盘，登录成功后会自动返回");
            webView.loadUrl("https://pan.quark.cn/");
        } else if (PROVIDER_BILIBILI.equals(provider)) {
            statusView.setText("请在哔哩哔哩官方页面登录，检测到账号后会自动返回");
            webView.loadUrl("https://passport.bilibili.com/login");
        } else if (PROVIDER_NETEASE.equals(provider)) {
            statusView.setText("请在网易云音乐官方页面登录，检测到账号后会自动返回");
            webView.loadUrl("https://music.163.com/#/login");
        } else {
            statusView.setText("正在打开官方授权页面…");
            requestOfficialAuthorizationUrl();
        }
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(8, 9, 14));

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(10), dp(8), dp(10), dp(8));
        toolbar.setBackgroundColor(Color.rgb(15, 16, 23));

        Button close = new Button(this);
        close.setText("关闭");
        close.setTextColor(Color.WHITE);
        close.setTextSize(13);
        close.setBackgroundColor(Color.TRANSPARENT);
        close.setOnClickListener(view -> finish());
        toolbar.addView(close, new LinearLayout.LayoutParams(dp(72), dp(48)));

        TextView title = new TextView(this);
        title.setText(PROVIDER_QUARK.equals(provider) ? "登录夸克网盘" : PROVIDER_BILIBILI.equals(provider) ? "绑定哔哩哔哩" : PROVIDER_NETEASE.equals(provider) ? "绑定网易云音乐" : PROVIDER_BAIDU.equals(provider) ? "授权百度网盘" : "授权阿里云盘");
        title.setTextColor(Color.WHITE);
        title.setTextSize(16);
        title.setGravity(Gravity.CENTER);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        toolbar.addView(title, new LinearLayout.LayoutParams(0, dp(48), 1));

        Button done = new Button(this);
        done.setText(PROVIDER_QUARK.equals(provider) || PROVIDER_BILIBILI.equals(provider) || PROVIDER_NETEASE.equals(provider) ? "完成" : "");
        done.setTextColor(Color.rgb(155, 145, 255));
        done.setTextSize(13);
        done.setBackgroundColor(Color.TRANSPARENT);
        done.setEnabled(PROVIDER_QUARK.equals(provider) || PROVIDER_BILIBILI.equals(provider) || PROVIDER_NETEASE.equals(provider));
        done.setOnClickListener(view -> {
            if (PROVIDER_BILIBILI.equals(provider)) captureBilibiliCookie(true);
            else if (PROVIDER_NETEASE.equals(provider)) captureNeteaseCookie(true);
            else captureQuarkCookie(true);
        });
        toolbar.addView(done, new LinearLayout.LayoutParams(dp(72), dp(48)));
        root.addView(toolbar, new LinearLayout.LayoutParams(-1, dp(64)));

        statusView = new TextView(this);
        statusView.setPadding(dp(16), dp(10), dp(16), dp(10));
        statusView.setTextColor(Color.rgb(184, 182, 195));
        statusView.setTextSize(12);
        statusView.setGravity(Gravity.CENTER_VERTICAL);
        root.addView(statusView, new LinearLayout.LayoutParams(-1, dp(44)));

        FrameLayout webContainer = new FrameLayout(this);
        webView = new WebView(this);
        webContainer.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        progressView = new ProgressBar(this);
        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(dp(36), dp(36), Gravity.CENTER);
        webContainer.addView(progressView, progressParams);
        root.addView(webContainer, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
    }

    private void configureWebView() {
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString().replace("; wv", ""));
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("https".equalsIgnoreCase(scheme)) {
                    inspectCallback(uri.toString());
                    return false;
                }
                if ("http".equalsIgnoreCase(scheme)) return true;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                progressView.setVisibility(View.VISIBLE);
                inspectCallback(url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressView.setVisibility(View.GONE);
                if (PROVIDER_QUARK.equals(provider)) {
                    captureQuarkCookie(false);
                } else if (PROVIDER_BILIBILI.equals(provider)) {
                    captureBilibiliCookie(false);
                } else if (PROVIDER_NETEASE.equals(provider)) {
                    captureNeteaseCookie(false);
                } else {
                    inspectCallback(url);
                    view.evaluateJavascript("(function(){var e=document.getElementById('refresh-token');return e&&e.value?e.value:''})()", value -> {
                        String token = unquoteJavascriptValue(value);
                        if (!token.isEmpty()) finishWithCredential(token, "refresh_token");
                    });
                }
            }
        });
    }

    private void requestOfficialAuthorizationUrl() {
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                String driver = PROVIDER_BAIDU.equals(provider) ? "baiduyun_go" : "alicloud_go";
                String prefix = PROVIDER_BAIDU.equals(provider) ? "baiduyun" : "alicloud";
                String query = "client_uid=&client_key=&driver_txt=" + URLEncoder.encode(driver, "UTF-8") + "&server_use=true";
                if (PROVIDER_BAIDU.equals(provider)) query += "&secret_key=";
                URL url = new URL("https://api.oplist.org/" + prefix + "/requests?" + query);
                connection = (HttpURLConnection) url.openConnection();
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(20000);
                connection.setRequestProperty("Accept", "application/json");
                int status = connection.getResponseCode();
                InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
                String body = readText(stream);
                if (status < 200 || status >= 300) throw new IllegalStateException("授权服务返回 " + status);
                String loginUrl = new JSONObject(body).optString("text");
                if (!loginUrl.startsWith("https://")) throw new IllegalStateException("没有获取到安全的授权地址");
                runOnUiThread(() -> {
                    statusView.setText("请在服务商官方页面完成登录与授权");
                    webView.loadUrl(loginUrl);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    progressView.setVisibility(View.GONE);
                    statusView.setText("无法打开授权页面，请检查网络后重试");
                });
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "bmovie-cloud-auth").start();
    }

    private void inspectCallback(String url) {
        if (completed || PROVIDER_QUARK.equals(provider) || url == null) return;
        try {
            Uri uri = Uri.parse(url);
            if (!"api.oplist.org".equalsIgnoreCase(uri.getHost())) return;
            String fragment = uri.getFragment();
            if (fragment == null || fragment.isEmpty()) return;
            String token = parseRefreshToken(fragment);
            if (!token.isEmpty()) finishWithCredential(token, "refresh_token");
        } catch (Exception ignored) { }
    }

    private String parseRefreshToken(String fragment) {
        String raw = Uri.decode(fragment);
        for (int flags : new int[]{Base64.DEFAULT, Base64.URL_SAFE | Base64.NO_WRAP}) {
            try {
                byte[] decoded = Base64.decode(raw, flags);
                JSONObject result = new JSONObject(new String(decoded, StandardCharsets.UTF_8));
                String token = result.optString("refresh_token");
                if (!token.isEmpty()) return token;
            } catch (Exception ignored) { }
        }
        return "";
    }

    private void captureQuarkCookie(boolean showError) {
        if (completed || !PROVIDER_QUARK.equals(provider)) return;
        CookieManager.getInstance().flush();
        String cookie = CookieManager.getInstance().getCookie("https://pan.quark.cn/");
        if (cookie != null && (cookie.contains("__pus=") || cookie.contains("__uid="))) {
            finishWithCredential(cookie, "cookie");
        } else if (showError) {
            statusView.setText("还没有检测到有效登录，请先完成夸克登录");
        }
    }

    private void captureBilibiliCookie(boolean showError) {
        if (completed || !PROVIDER_BILIBILI.equals(provider)) return;
        CookieManager.getInstance().flush();
        String cookie = mergeCookies(
            CookieManager.getInstance().getCookie("https://www.bilibili.com/"),
            CookieManager.getInstance().getCookie("https://api.bilibili.com/"),
            CookieManager.getInstance().getCookie("https://passport.bilibili.com/")
        );
        if (cookie.contains("SESSDATA=") && cookie.contains("DedeUserID=")) {
            finishWithCredential(cookie, "cookie");
        } else if (showError) {
            statusView.setText("还没有检测到有效账号，请先完成哔哩哔哩登录");
        }
    }

    private void captureNeteaseCookie(boolean showError) {
        if (completed || !PROVIDER_NETEASE.equals(provider)) return;
        CookieManager.getInstance().flush();
        String cookie = mergeCookies(
            CookieManager.getInstance().getCookie("https://music.163.com/"),
            CookieManager.getInstance().getCookie("https://interface.music.163.com/")
        );
        if (cookie.contains("MUSIC_U=")) {
            finishWithCredential(cookie, "cookie");
        } else if (showError) {
            statusView.setText("还没有检测到有效账号，请先完成网易云音乐登录");
        }
    }

    private static String mergeCookies(String... cookieGroups) {
        java.util.LinkedHashMap<String, String> values = new java.util.LinkedHashMap<>();
        for (String group : cookieGroups) {
            if (group == null) continue;
            for (String part : group.split(";")) {
                String trimmed = part.trim();
                int split = trimmed.indexOf('=');
                if (split > 0) values.put(trimmed.substring(0, split), trimmed.substring(split + 1));
            }
        }
        StringBuilder result = new StringBuilder();
        for (java.util.Map.Entry<String, String> entry : values.entrySet()) {
            if (result.length() > 0) result.append("; ");
            result.append(entry.getKey()).append('=').append(entry.getValue());
        }
        return result.toString();
    }

    private void finishWithCredential(String credential, String type) {
        if (completed || credential == null || credential.trim().isEmpty()) return;
        completed = true;
        Intent data = new Intent();
        data.putExtra(RESULT_CREDENTIAL, credential);
        data.putExtra(RESULT_CREDENTIAL_TYPE, type);
        setResult(Activity.RESULT_OK, data);
        finish();
    }

    private static String readText(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }

    private static String unquoteJavascriptValue(String value) {
        if (value == null || "null".equals(value) || value.length() < 2) return "";
        try { return new org.json.JSONTokener(value).nextValue().toString(); }
        catch (Exception ignored) { return ""; }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.setWebViewClient(null);
            webView.destroy();
        }
        super.onDestroy();
    }
}
