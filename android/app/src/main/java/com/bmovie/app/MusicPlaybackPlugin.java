package com.bmovie.app;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(
    name = "MusicPlayback",
    permissions = @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
)
public class MusicPlaybackPlugin extends Plugin {
    private BroadcastReceiver stateReceiver;

    @Override public void load() {
        stateReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                notifyListeners("stateChanged", stateFromIntent(intent));
            }
        };
        ContextCompat.registerReceiver(
            getContext(),
            stateReceiver,
            new IntentFilter(MusicPlaybackService.EVENT_STATE),
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
    }

    @Override protected void handleOnDestroy() {
        if (stateReceiver != null) getContext().unregisterReceiver(stateReceiver);
        stateReceiver = null;
    }

    @PluginMethod public void setQueue(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationPermissionResult");
            return;
        }
        applyQueue(call);
    }

    @PermissionCallback private void notificationPermissionResult(PluginCall call) {
        // Playback still works when notification permission is denied; Android may hide the drawer card.
        applyQueue(call);
    }

    private void applyQueue(PluginCall call) {
        try {
            JSArray values = call.getArray("tracks", new JSArray());
            List<MusicPlaybackService.Track> tracks = new ArrayList<>();
            for (int index = 0; index < values.length(); index++) {
                JSONObject value = values.getJSONObject(index);
                String url = value.optString("url", "");
                if (url.isEmpty()) continue;
                tracks.add(new MusicPlaybackService.Track(
                    value.optString("id", String.valueOf(index)),
                    url,
                    value.optString("title", "未知歌曲"),
                    value.optString("artist", "未知艺术家"),
                    value.optString("album", "未知专辑"),
                    value.optString("artwork", "")
                ));
            }
            if (tracks.isEmpty()) throw new IllegalArgumentException("播放队列为空");
            MusicPlaybackService.setQueue(
                getContext(),
                tracks,
                call.getInt("index", 0),
                Math.round(call.getDouble("position", 0.0) * 1000),
                call.getBoolean("autoplay", true)
            );
            call.resolve(stateObject(MusicPlaybackService.snapshot()));
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "无法启动后台播放" : error.getMessage(), error);
        }
    }

    @PluginMethod public void play(PluginCall call) { MusicPlaybackService.play(getContext()); call.resolve(); }
    @PluginMethod public void pause(PluginCall call) { MusicPlaybackService.pause(getContext()); call.resolve(); }
    @PluginMethod public void previous(PluginCall call) { MusicPlaybackService.previous(getContext()); call.resolve(); }
    @PluginMethod public void next(PluginCall call) { MusicPlaybackService.next(getContext()); call.resolve(); }

    @PluginMethod public void seek(PluginCall call) {
        MusicPlaybackService.seek(getContext(), Math.round(call.getDouble("position", 0.0) * 1000));
        call.resolve();
    }

    @PluginMethod public void getState(PluginCall call) {
        call.resolve(stateObject(MusicPlaybackService.snapshot()));
    }

    private static JSObject stateFromIntent(Intent intent) {
        JSObject state = new JSObject();
        state.put("playing", intent.getBooleanExtra("playing", false));
        state.put("index", intent.getIntExtra("index", -1));
        state.put("position", intent.getLongExtra("positionMs", 0) / 1000.0);
        state.put("duration", intent.getLongExtra("durationMs", 0) / 1000.0);
        state.put("mediaId", intent.getStringExtra("mediaId"));
        return state;
    }

    private static JSObject stateObject(MusicPlaybackService.PlaybackSnapshot snapshot) {
        JSObject state = new JSObject();
        state.put("playing", snapshot.playing);
        state.put("index", snapshot.index);
        state.put("position", snapshot.positionMs / 1000.0);
        state.put("duration", snapshot.durationMs / 1000.0);
        state.put("mediaId", snapshot.mediaId);
        return state;
    }
}
