package com.bmovie.app;

import android.content.Context;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

final class PlayerPayloadStore {
    private static final String DIRECTORY = "player_payloads";
    private static final long MAX_AGE_MS = 24L * 60L * 60L * 1000L;

    private PlayerPayloadStore() {}

    static String write(Context context, JSONObject payload) throws Exception {
        File directory = new File(context.getCacheDir(), DIRECTORY);
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IllegalStateException("无法创建播放器临时数据目录");
        }
        purgeExpired(directory);
        File file = new File(directory, UUID.randomUUID() + ".json");
        byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
        try (BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(file))) {
            output.write(bytes);
        }
        return file.getAbsolutePath();
    }

    static JSONObject read(String path) {
        if (path == null || path.isEmpty()) return null;
        File file = new File(path);
        if (!file.isFile()) return null;
        try (BufferedInputStream input = new BufferedInputStream(new FileInputStream(file));
             ByteArrayOutputStream output = new ByteArrayOutputStream((int) Math.min(file.length(), 1024 * 1024))) {
            byte[] buffer = new byte[16 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
        } catch (Exception ignored) {
            return null;
        }
    }

    static void delete(String path) {
        if (path == null || path.isEmpty()) return;
        File file = new File(path);
        if (file.isFile()) file.delete();
    }

    private static void purgeExpired(File directory) {
        File[] files = directory.listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - MAX_AGE_MS;
        for (File file : files) {
            if (file.isFile() && file.lastModified() < cutoff) file.delete();
        }
    }
}
