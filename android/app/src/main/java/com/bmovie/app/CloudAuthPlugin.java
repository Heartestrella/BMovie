package com.bmovie.app;

import android.app.Activity;
import android.content.Intent;
import android.webkit.CookieManager;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "CloudAuth")
public class CloudAuthPlugin extends Plugin {
    @PluginMethod
    public void restore(PluginCall call) {
        String provider = call.getString("provider", "");
        if (!"netease".equals(provider)) {
            call.reject("此服务暂不支持静默恢复登录");
            return;
        }
        CookieManager.getInstance().flush();
        String credential = CookieManager.getInstance().getCookie("https://music.163.com/");
        if (credential == null || !credential.contains("MUSIC_U=")) {
            call.reject("没有找到可恢复的网易云登录");
            return;
        }
        JSObject response = new JSObject();
        response.put("credential", credential);
        response.put("credentialType", "cookie");
        call.resolve(response);
    }

    @PluginMethod
    public void login(PluginCall call) {
        String provider = call.getString("provider", "");
        if (!CloudAuthActivity.isSupportedProvider(provider)) {
            call.reject("暂不支持此服务的自动登录");
            return;
        }
        Intent intent = new Intent(getContext(), CloudAuthActivity.class);
        intent.putExtra(CloudAuthActivity.EXTRA_PROVIDER, provider);
        startActivityForResult(call, intent, "authFinished");
    }

    @ActivityCallback
    private void authFinished(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            call.reject("已取消登录");
            return;
        }
        String credential = data.getStringExtra(CloudAuthActivity.RESULT_CREDENTIAL);
        if (credential == null || credential.trim().isEmpty()) {
            call.reject("登录完成，但没有获取到授权信息");
            return;
        }
        JSObject response = new JSObject();
        response.put("credential", credential);
        response.put("credentialType", data.getStringExtra(CloudAuthActivity.RESULT_CREDENTIAL_TYPE));
        call.resolve(response);
    }
}
