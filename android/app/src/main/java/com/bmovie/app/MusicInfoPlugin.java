package com.bmovie.app;

import android.media.AudioFormat;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.URI;
import java.util.HashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "MusicInfo")
public class MusicInfoPlugin extends Plugin {
    private static final Pattern BITS_PATTERN = Pattern.compile("(?:bits-per-sample|bit-depth|bits_per_sample)[=:]\\s*(\\d+)", Pattern.CASE_INSENSITIVE);

    @PluginMethod
    public void probe(PluginCall call) {
        String rawUrl = call.getString("url", "");
        new Thread(() -> {
            MediaExtractor extractor = new MediaExtractor();
            MediaMetadataRetriever retriever = new MediaMetadataRetriever();
            try {
                URI uri = URI.create(rawUrl);
                if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))) {
                    throw new IllegalArgumentException("不允许探测此音频地址");
                }
                HashMap<String, String> headers = new HashMap<>();
                headers.put("User-Agent", "BMovie/0.1 Android");
                extractor.setDataSource(rawUrl, headers);
                retriever.setDataSource(rawUrl, headers);

                JSObject result = new JSObject();
                for (int index = 0; index < extractor.getTrackCount(); index++) {
                    MediaFormat format = extractor.getTrackFormat(index);
                    String mime = format.getString(MediaFormat.KEY_MIME);
                    if (mime == null || !mime.startsWith("audio/")) continue;
                    result.put("mimeType", mime);
                    putInteger(format, MediaFormat.KEY_BIT_RATE, result, "bitrate");
                    putInteger(format, MediaFormat.KEY_SAMPLE_RATE, result, "sampleRate");
                    putInteger(format, MediaFormat.KEY_CHANNEL_COUNT, result, "channels");
                    putLong(format, MediaFormat.KEY_DURATION, result, "durationUs");

                    int bitDepth = firstInteger(format, "bits-per-sample", "bit-depth", "bits_per_sample");
                    if (bitDepth <= 0 && format.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                        bitDepth = pcmBitDepth(format.getInteger(MediaFormat.KEY_PCM_ENCODING));
                    }
                    if (bitDepth <= 0) {
                        Matcher matcher = BITS_PATTERN.matcher(format.toString());
                        if (matcher.find()) bitDepth = Integer.parseInt(matcher.group(1));
                    }
                    if (bitDepth > 0) result.put("bitDepth", bitDepth);
                    break;
                }

                putMetadata(result, "title", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE));
                putMetadata(result, "artist", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST));
                putMetadata(result, "album", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM));
                putMetadata(result, "albumArtist", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST));
                putMetadata(result, "track", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER));
                putMetadata(result, "disc", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DISC_NUMBER));
                putFallbackNumber(result, "bitrate", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE));
                putFallbackDuration(result, retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "音频参数读取失败" : error.getMessage(), error);
            } finally {
                try { extractor.release(); } catch (Exception ignored) {}
                try { retriever.release(); } catch (Exception ignored) {}
            }
        }, "BMovieMusicInfo").start();
    }

    private static void putInteger(MediaFormat format, String key, JSObject result, String output) {
        try { if (format.containsKey(key)) result.put(output, format.getInteger(key)); } catch (Exception ignored) {}
    }

    private static void putLong(MediaFormat format, String key, JSObject result, String output) {
        try { if (format.containsKey(key)) result.put(output, format.getLong(key)); } catch (Exception ignored) {}
    }

    private static int firstInteger(MediaFormat format, String... keys) {
        for (String key : keys) {
            try { if (format.containsKey(key)) return format.getInteger(key); } catch (Exception ignored) {}
        }
        return 0;
    }

    private static int pcmBitDepth(int encoding) {
        if (encoding == AudioFormat.ENCODING_PCM_8BIT) return 8;
        if (encoding == AudioFormat.ENCODING_PCM_16BIT) return 16;
        if (encoding == AudioFormat.ENCODING_PCM_24BIT_PACKED) return 24;
        if (encoding == AudioFormat.ENCODING_PCM_32BIT || encoding == AudioFormat.ENCODING_PCM_FLOAT) return 32;
        return 0;
    }

    private static void putMetadata(JSObject result, String key, String value) {
        if (value != null && !value.trim().isEmpty()) result.put(key, value.trim());
    }

    private static void putFallbackNumber(JSObject result, String key, String value) {
        if (result.has(key) || value == null) return;
        try { result.put(key, Long.parseLong(value)); } catch (NumberFormatException ignored) {}
    }

    private static void putFallbackDuration(JSObject result, String value) {
        if (result.has("durationUs") || value == null) return;
        try { result.put("durationUs", Long.parseLong(value) * 1000L); } catch (NumberFormatException ignored) {}
    }
}
