package com.bmovie.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {
    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("播放地址为空");
            return;
        }
        Intent intent = new Intent(getContext(), PlayerActivity.class);
        intent.putExtra(PlayerActivity.EXTRA_URL, url);
        intent.putExtra(PlayerActivity.EXTRA_TITLE, call.getString("title", ""));
        intent.putExtra(PlayerActivity.EXTRA_POSITION, call.getDouble("position", 0.0).longValue());
        JSArray subtitles = call.getArray("subtitles");
        intent.putExtra(PlayerActivity.EXTRA_SUBTITLES, subtitles == null ? "[]" : subtitles.toString());
        startActivityForResult(call, intent, "playerFinished");
    }

    @PluginMethod
    public void playExternal(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("播放地址为空");
            return;
        }

        Uri videoUri = Uri.parse(url);
        Intent viewIntent = new Intent(Intent.ACTION_VIEW);
        viewIntent.setDataAndType(videoUri, "video/*");
        viewIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_DOCUMENT | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        ClipData sharedUris = "content".equalsIgnoreCase(videoUri.getScheme()) ? ClipData.newRawUri("video", videoUri) : null;
        String title = call.getString("title", "");
        long position = call.getDouble("position", 0.0).longValue();
        viewIntent.putExtra("title", title);
        viewIntent.putExtra("android.intent.extra.TITLE", title);
        viewIntent.putExtra("position", position);
        viewIntent.putExtra("from_start", position <= 0);

        JSArray subtitles = call.getArray("subtitles");
        if (subtitles != null && subtitles.length() > 0) {
            java.util.ArrayList<Uri> subtitleUris = new java.util.ArrayList<>();
            java.util.ArrayList<String> subtitleNames = new java.util.ArrayList<>();
            for (int index = 0; index < subtitles.length(); index++) {
                org.json.JSONObject subtitle = subtitles.optJSONObject(index);
                if (subtitle == null || subtitle.optString("url").isEmpty()) continue;
                subtitleUris.add(Uri.parse(subtitle.optString("url")));
                subtitleNames.add(subtitle.optString("label", "字幕 " + (index + 1)));
                Uri subtitleUri = subtitleUris.get(subtitleUris.size() - 1);
                if ("content".equalsIgnoreCase(subtitleUri.getScheme())) {
                    if (sharedUris == null) sharedUris = ClipData.newRawUri("subtitle", subtitleUri);
                    else sharedUris.addItem(new ClipData.Item(subtitleUri));
                }
            }
            if (!subtitleUris.isEmpty()) {
                viewIntent.putParcelableArrayListExtra("subs", subtitleUris);
                viewIntent.putStringArrayListExtra("subs.name", subtitleNames);
                viewIntent.putExtra("subs.enable", true);
            }
        }
        if (sharedUris != null) viewIntent.setClipData(sharedUris);

        try {
            Intent chooser = Intent.createChooser(viewIntent, "选择播放器");
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (ActivityNotFoundException error) {
            call.reject("没有找到支持此视频的外部播放器");
        } catch (Exception error) {
            call.reject("无法拉起外部播放器：" + error.getMessage());
        }
    }

    @ActivityCallback
    private void playerFinished(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        JSObject response = new JSObject();
        response.put("position", data == null ? 0 : data.getLongExtra(PlayerActivity.RESULT_POSITION, 0));
        response.put("duration", data == null ? 0 : data.getLongExtra(PlayerActivity.RESULT_DURATION, 0));
        call.resolve(response);
    }
}
