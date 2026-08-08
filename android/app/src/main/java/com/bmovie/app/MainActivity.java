package com.bmovie.app;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OpenListPlugin.class);
        registerPlugin(NativePlayerPlugin.class);
        registerPlugin(NativeHttpPlugin.class);
        super.onCreate(savedInstanceState);
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String host = request.getUrl().getHost();
                if ("image.tmdb.org".equals(host) || "images.tmdb.org".equals(host)) {
                    WebResourceResponse response = NativeHttpPlugin.interceptTmdbImage(MainActivity.this, request.getUrl().toString());
                    if (response != null) return response;
                }
                return super.shouldInterceptRequest(view, request);
            }
        });
    }
}
