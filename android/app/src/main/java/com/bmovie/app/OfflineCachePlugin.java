package com.bmovie.app;

import android.app.DownloadManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.net.URI;
import java.net.URLConnection;
import java.util.Iterator;

@CapacitorPlugin(name = "OfflineCache")
public class OfflineCachePlugin extends Plugin {
    private static final String PREFS_NAME = "bmovie_offline_cache";
    private static final String INDEX_KEY = "entries";
    private static final String CACHE_DIRECTORY = "BMovieCache";
    private static final long SPACE_RESERVE = 128L * 1024L * 1024L;
    private static final Object INDEX_LOCK = new Object();

    @PluginMethod
    public void start(PluginCall call) {
        try {
            Context context = getContext();
            String id = safeId(call.getString("id", ""));
            String url = call.getString("url", "");
            validateDownloadUrl(url);
            if (id.isEmpty()) throw new IllegalArgumentException("缓存标识为空");

            File moviesDirectory = context.getExternalFilesDir(Environment.DIRECTORY_MOVIES);
            if (moviesDirectory == null) throw new IllegalStateException("无法访问应用缓存目录");
            File cacheDirectory = new File(moviesDirectory, CACHE_DIRECTORY);
            if (!cacheDirectory.exists() && !cacheDirectory.mkdirs()) throw new IllegalStateException("无法创建缓存目录");

            long expectedSize = call.getLong("expectedSize", 0L);
            if (expectedSize > 0 && cacheDirectory.getUsableSpace() - SPACE_RESERVE < expectedSize) {
                throw new IllegalStateException("本机存储空间不足");
            }

            DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
            synchronized (INDEX_LOCK) {
                JSONObject index = readIndex(context);
                JSONObject existing = index.optJSONObject(id);
                if (existing != null) {
                    JSObject snapshot = renderEntry(context, manager, existing);
                    if ("completed".equals(snapshot.optString("status"))) {
                        call.resolve(snapshot);
                        return;
                    }
                    removeDownloadsAndFiles(context, manager, existing);
                }

                String fileName = safeFileName(call.getString("fileName", "video.mp4"));
                String relativePath = CACHE_DIRECTORY + "/" + id + "-" + fileName;
                File destination = new File(moviesDirectory, relativePath);
                if (destination.exists() && !destination.delete()) throw new IllegalStateException("无法覆盖旧缓存文件");

                DownloadManager.Request request = createRequest(context, url, call.getString("title", fileName), relativePath, fileName);
                long downloadId = manager.enqueue(request);
                JSONObject entry = new JSONObject();
                entry.put("id", id);
                entry.put("downloadId", downloadId);
                entry.put("sourcePath", call.getString("sourcePath", ""));
                entry.put("title", call.getString("title", fileName));
                entry.put("fileName", fileName);
                entry.put("poster", call.getString("poster", ""));
                entry.put("relativePath", relativePath);
                entry.put("expectedSize", expectedSize);
                entry.put("createdAt", System.currentTimeMillis());
                entry.put("subtitles", enqueueSubtitles(context, manager, moviesDirectory, id, call.getArray("subtitles")));
                index.put(id, entry);
                writeIndex(context, index);
                call.resolve(renderEntry(context, manager, entry));
            }
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "无法开始缓存" : error.getMessage(), error);
        }
    }

    @PluginMethod
    public void list(PluginCall call) {
        try {
            Context context = getContext();
            DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
            JSArray items = new JSArray();
            synchronized (INDEX_LOCK) {
                JSONObject index = readIndex(context);
                Iterator<String> keys = index.keys();
                while (keys.hasNext()) {
                    JSONObject entry = index.optJSONObject(keys.next());
                    if (entry != null) items.put(renderEntry(context, manager, entry));
                }
            }
            JSObject result = new JSObject();
            result.put("items", items);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "无法读取缓存列表" : error.getMessage(), error);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        try {
            Context context = getContext();
            String id = safeId(call.getString("id", ""));
            DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
            synchronized (INDEX_LOCK) {
                JSONObject index = readIndex(context);
                JSONObject entry = index.optJSONObject(id);
                if (entry != null) removeDownloadsAndFiles(context, manager, entry);
                index.remove(id);
                writeIndex(context, index);
            }
            call.resolve();
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "无法删除缓存" : error.getMessage(), error);
        }
    }

    private static DownloadManager.Request createRequest(Context context, String url, String title, String relativePath, String fileName) {
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
            .setTitle(title)
            .setDescription("BMovie 离线缓存")
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(false)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_MOVIES, relativePath);
        String mimeType = URLConnection.guessContentTypeFromName(fileName);
        if (mimeType != null) request.setMimeType(mimeType);
        return request;
    }

    private JSONArray enqueueSubtitles(Context context, DownloadManager manager, File moviesDirectory, String id, JSArray subtitles) throws Exception {
        JSONArray stored = new JSONArray();
        if (subtitles == null) return stored;
        for (int index = 0; index < Math.min(subtitles.length(), 12); index++) {
            JSONObject subtitle = subtitles.optJSONObject(index);
            if (subtitle == null) continue;
            String url = subtitle.optString("url");
            try { validateDownloadUrl(url); } catch (Exception ignored) { continue; }
            String fileName = safeFileName(subtitle.optString("fileName", "subtitle-" + index + ".srt"));
            String extension = extension(fileName);
            String relativePath = CACHE_DIRECTORY + "/" + id + "-subtitle-" + index + extension;
            File destination = new File(moviesDirectory, relativePath);
            if (destination.exists()) destination.delete();
            long downloadId = manager.enqueue(createRequest(context, url, subtitle.optString("label", "字幕"), relativePath, fileName));
            JSONObject storedSubtitle = new JSONObject();
            storedSubtitle.put("downloadId", downloadId);
            storedSubtitle.put("relativePath", relativePath);
            storedSubtitle.put("label", subtitle.optString("label", "字幕"));
            storedSubtitle.put("language", subtitle.optString("language"));
            storedSubtitle.put("mimeType", subtitle.optString("mimeType", "application/x-subrip"));
            stored.put(storedSubtitle);
        }
        return stored;
    }

    private static JSObject renderEntry(Context context, DownloadManager manager, JSONObject entry) throws Exception {
        DownloadState state = query(manager, entry.optLong("downloadId"));
        File video = resolveFile(context, entry.optString("relativePath"));
        String status = statusLabel(state.status, video.exists());
        long downloaded = state.downloaded >= 0 ? state.downloaded : video.length();
        long total = state.total > 0 ? state.total : Math.max(entry.optLong("expectedSize"), video.length());
        JSObject result = new JSObject();
        result.put("id", entry.optString("id"));
        result.put("sourcePath", entry.optString("sourcePath"));
        result.put("title", entry.optString("title"));
        result.put("fileName", entry.optString("fileName"));
        result.put("poster", entry.optString("poster"));
        result.put("createdAt", entry.optLong("createdAt"));
        result.put("status", status);
        result.put("downloaded", downloaded);
        result.put("total", total);
        result.put("size", video.exists() ? video.length() : downloaded);
        result.put("error", errorLabel(state));
        if ("completed".equals(status)) {
            result.put("uri", contentUri(context, video));
            result.put("internalUri", Uri.fromFile(video).toString());
        }

        JSArray subtitles = new JSArray();
        JSONArray storedSubtitles = entry.optJSONArray("subtitles");
        if (storedSubtitles != null) {
            for (int index = 0; index < storedSubtitles.length(); index++) {
                JSONObject subtitle = storedSubtitles.optJSONObject(index);
                if (subtitle == null) continue;
                File file = resolveFile(context, subtitle.optString("relativePath"));
                DownloadState subtitleState = query(manager, subtitle.optLong("downloadId"));
                if (subtitleState.status != DownloadManager.STATUS_SUCCESSFUL || !file.exists()) continue;
                JSObject item = new JSObject();
                item.put("url", contentUri(context, file));
                item.put("internalUrl", Uri.fromFile(file).toString());
                item.put("label", subtitle.optString("label", "字幕"));
                item.put("language", subtitle.optString("language"));
                item.put("mimeType", subtitle.optString("mimeType", "application/x-subrip"));
                subtitles.put(item);
                result.put("size", result.optLong("size") + file.length());
            }
        }
        result.put("subtitles", subtitles);
        return result;
    }

    private static void removeDownloadsAndFiles(Context context, DownloadManager manager, JSONObject entry) throws Exception {
        long videoId = entry.optLong("downloadId", -1);
        if (videoId >= 0) manager.remove(videoId);
        File video = resolveFile(context, entry.optString("relativePath"));
        if (video.exists()) video.delete();
        JSONArray subtitles = entry.optJSONArray("subtitles");
        if (subtitles == null) return;
        for (int index = 0; index < subtitles.length(); index++) {
            JSONObject subtitle = subtitles.optJSONObject(index);
            if (subtitle == null) continue;
            long downloadId = subtitle.optLong("downloadId", -1);
            if (downloadId >= 0) manager.remove(downloadId);
            File file = resolveFile(context, subtitle.optString("relativePath"));
            if (file.exists()) file.delete();
        }
    }

    private static DownloadState query(DownloadManager manager, long id) {
        if (id < 0) return new DownloadState(DownloadManager.STATUS_FAILED, 0, 0, DownloadManager.ERROR_UNKNOWN);
        try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id))) {
            if (cursor != null && cursor.moveToFirst()) {
                return new DownloadState(
                    cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)),
                    cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)),
                    cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)),
                    cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
                );
            }
        } catch (Exception ignored) {}
        return new DownloadState(DownloadManager.STATUS_FAILED, 0, 0, DownloadManager.ERROR_UNKNOWN);
    }

    private static String statusLabel(int status, boolean fileExists) {
        if (status == DownloadManager.STATUS_SUCCESSFUL && fileExists) return "completed";
        if (status == DownloadManager.STATUS_RUNNING) return "downloading";
        if (status == DownloadManager.STATUS_PENDING) return "queued";
        if (status == DownloadManager.STATUS_PAUSED) return "paused";
        return "failed";
    }

    private static String errorLabel(DownloadState state) {
        if (state.status == DownloadManager.STATUS_PAUSED) return "下载已暂停，等待网络恢复";
        if (state.status != DownloadManager.STATUS_FAILED) return "";
        if (state.reason == DownloadManager.ERROR_INSUFFICIENT_SPACE) return "本机存储空间不足";
        if (state.reason == DownloadManager.ERROR_CANNOT_RESUME) return "下载链接已失效，请重试";
        if (state.reason >= 400 && state.reason < 600) return "下载服务器返回 " + state.reason;
        return "下载失败，请重试";
    }

    private static String contentUri(Context context, File file) {
        return FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file).toString();
    }

    private static File resolveFile(Context context, String relativePath) throws Exception {
        File moviesDirectory = context.getExternalFilesDir(Environment.DIRECTORY_MOVIES);
        if (moviesDirectory == null) throw new IllegalStateException("缓存目录不可用");
        File cacheDirectory = new File(moviesDirectory, CACHE_DIRECTORY).getCanonicalFile();
        File file = new File(moviesDirectory, relativePath).getCanonicalFile();
        if (!file.getPath().startsWith(cacheDirectory.getPath() + File.separator)) throw new SecurityException("缓存路径无效");
        return file;
    }

    private static JSONObject readIndex(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        try { return new JSONObject(preferences.getString(INDEX_KEY, "{}")); }
        catch (Exception ignored) { return new JSONObject(); }
    }

    private static void writeIndex(Context context, JSONObject index) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().putString(INDEX_KEY, index.toString()).apply();
    }

    private static void validateDownloadUrl(String value) throws Exception {
        URI uri = URI.create(value);
        if (!("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme())) || uri.getHost() == null) {
            throw new IllegalArgumentException("下载地址无效");
        }
    }

    private static String safeId(String value) {
        String cleaned = value == null ? "" : value.replaceAll("[^A-Za-z0-9_-]", "");
        return cleaned.substring(0, Math.min(cleaned.length(), 80));
    }

    private static String safeFileName(String value) {
        String cleaned = value == null ? "video.mp4" : value.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (cleaned.isEmpty()) cleaned = "video.mp4";
        if (cleaned.length() > 120) cleaned = cleaned.substring(cleaned.length() - 120);
        return cleaned;
    }

    private static String extension(String fileName) {
        int dot = fileName.lastIndexOf('.');
        if (dot < 0 || fileName.length() - dot > 8) return ".srt";
        return fileName.substring(dot).toLowerCase();
    }

    private static class DownloadState {
        final int status;
        final long downloaded;
        final long total;
        final int reason;
        DownloadState(int status, long downloaded, long total, int reason) {
            this.status = status;
            this.downloaded = downloaded;
            this.total = total;
            this.reason = reason;
        }
    }

}
