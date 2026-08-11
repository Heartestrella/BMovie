package com.bmovie.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Map;

@CapacitorPlugin(name = "CloudOffline")
public class CloudOfflinePlugin extends Plugin {
    private static final Map<String, String> PACKAGES = Map.of(
        "quark", "com.quark.browser",
        "baidu", "com.baidu.netdisk"
    );

    @PluginMethod
    public void sendMagnet(PluginCall call) {
        String provider = call.getString("provider", "");
        String magnet = call.getString("magnet", "").trim();
        String packageName = PACKAGES.get(provider);
        if (packageName == null) {
            call.reject("暂不支持此网盘");
            return;
        }
        if (!magnet.regionMatches(true, 0, "magnet:?xt=urn:btih:", 0, 20)) {
            call.reject("请输入有效的磁力链接");
            return;
        }

        copyToClipboard(magnet);
        Intent direct = new Intent(Intent.ACTION_VIEW, Uri.parse(magnet));
        direct.setPackage(packageName);
        direct.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (direct.resolveActivity(getContext().getPackageManager()) != null) {
            getContext().startActivity(direct);
            resolve(call, "dispatched", "已发送到网盘客户端");
            return;
        }

        Intent launch = getContext().getPackageManager().getLaunchIntentForPackage(packageName);
        if (launch == null) {
            call.reject("未安装所选网盘客户端");
            return;
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(launch);
        resolve(call, "clipboard", "磁力链接已复制，请在网盘客户端中确认离线下载");
    }

    @PluginMethod
    public void pickTorrent(PluginCall call) {
        if (!PACKAGES.containsKey(call.getString("provider", ""))) {
            call.reject("暂不支持此网盘");
            return;
        }
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        picker.addCategory(Intent.CATEGORY_OPENABLE);
        picker.setType("application/x-bittorrent");
        picker.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/x-bittorrent", "application/octet-stream"});
        startActivityForResult(call, picker, "torrentPicked");
    }

    @ActivityCallback
    private void torrentPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            call.reject("已取消选择种子");
            return;
        }
        String packageName = PACKAGES.get(call.getString("provider", ""));
        Intent target = new Intent(Intent.ACTION_VIEW);
        target.setDataAndType(uri, "application/x-bittorrent");
        target.setPackage(packageName);
        target.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        if (target.resolveActivity(getContext().getPackageManager()) == null) {
            call.reject("所选网盘客户端不支持直接接收种子文件");
            return;
        }
        getContext().grantUriPermission(packageName, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getContext().startActivity(target);
        resolve(call, "dispatched", "种子文件已发送到网盘客户端");
    }

    private void copyToClipboard(String text) {
        ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText("磁力链接", text));
    }

    private void resolve(PluginCall call, String mode, String message) {
        JSObject result = new JSObject();
        result.put("mode", mode);
        result.put("message", message);
        call.resolve(result);
    }
}
