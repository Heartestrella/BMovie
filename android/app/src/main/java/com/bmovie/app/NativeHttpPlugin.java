package com.bmovie.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.WebResourceResponse;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.net.InetAddress;
import java.net.URI;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.Inflater;
import java.util.zip.InflaterInputStream;

import okhttp3.Cache;
import okhttp3.Dns;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

@CapacitorPlugin(name = "NativeHttp")
public class NativeHttpPlugin extends Plugin {
    private static final Set<String> JSON_HOSTS = Set.of("api.bgm.tv", "api.themoviedb.org", "music.163.com", "api.bilibili.com");
    private static final Set<String> HTML_HOSTS = Set.of("www.btbtla.com");
    private static final Set<String> TMDB_HOSTS = Set.of("api.themoviedb.org", "image.tmdb.org", "images.tmdb.org");
    private static final String CHECK_TMDB_URL = "https://raw.githubusercontent.com/cnwikee/CheckTMDB/refs/heads/main/Tmdb_host_ipv4";
    private static final String PREFS_NAME = "bmovie_trusted_dns";
    private static final String PREFS_TMDB_HOSTS = "tmdb_ipv4_hosts";
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private static final Pattern HOST_LINE = Pattern.compile("(?m)^\\s*((?:\\d{1,3}\\.){3}\\d{1,3})\\s+(api\\.themoviedb\\.org|images?\\.tmdb\\.org)\\s*$");
    private static final Map<String, List<InetAddress>> tmdbAddresses = new ConcurrentHashMap<>();
    private static final AtomicBoolean initialized = new AtomicBoolean(false);
    private static final AtomicBoolean refreshStarted = new AtomicBoolean(false);
    private static volatile List<InetAddress> bangumiAddresses;
    private static volatile OkHttpClient client;

    static {
        putAddress("api.themoviedb.org", "13.249.74.100");
        putAddress("image.tmdb.org", "143.244.50.87");
        putAddress("images.tmdb.org", "143.244.50.82");
    }

    @PluginMethod
    public void request(PluginCall call) {
        String rawUrl = call.getString("url", "");
        String method = call.getString("method", "GET").toUpperCase();
        String body = call.getString("body", "");
        new Thread(() -> {
            try {
                URI uri = URI.create(rawUrl);
                if (!"https".equalsIgnoreCase(uri.getScheme()) || (!JSON_HOSTS.contains(uri.getHost()) && !HTML_HOSTS.contains(uri.getHost()))) {
                    throw new IllegalArgumentException("不允许访问此元数据地址");
                }
                initialize(getContext());
                if (TMDB_HOSTS.contains(uri.getHost())) refreshTmdbHostsAsync(getContext());
                RequestBody requestBody = body.isEmpty() ? null : RequestBody.create(body, JSON);
                Request.Builder builder = new Request.Builder()
                    .url(rawUrl)
                    .header("Accept", HTML_HOSTS.contains(uri.getHost()) ? "text/html,application/xhtml+xml" : "application/json")
                    .header("User-Agent", "BMovie/0.1 Android")
                    .method(method, requestBody);
                if ("music.163.com".equals(uri.getHost())) builder.header("Referer", "https://music.163.com/");
                if ("api.bilibili.com".equals(uri.getHost())) {
                    builder.header("Referer", "https://www.bilibili.com/");
                    builder.header("Accept-Encoding", "identity");
                }
                copyAllowedHeaders(call.getObject("headers"), builder);
                try (Response response = httpClient().newCall(builder.build()).execute()) {
                    JSObject result = new JSObject();
                    result.put("status", response.code());
                    result.put("contentType", response.header("Content-Type", ""));
                    result.put("contentEncoding", response.header("Content-Encoding", ""));
                    result.put("body", decodeResponseBody(response));
                    call.resolve(result);
                }
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "元数据请求失败" : error.getMessage(), error);
            }
        }, "BMovieMetadata").start();
    }

    @PluginMethod
    public void prefetchImage(PluginCall call) {
        String rawUrl = call.getString("url", "");
        new Thread(() -> {
            try {
                URI uri = URI.create(rawUrl);
                if (!"https".equalsIgnoreCase(uri.getScheme()) || !TMDB_HOSTS.contains(uri.getHost()) || "api.themoviedb.org".equals(uri.getHost())) {
                    throw new IllegalArgumentException("不允许预取此图片地址");
                }
                initialize(getContext());
                refreshTmdbHostsAsync(getContext());
                String effectiveUrl = "image.tmdb.org".equals(uri.getHost())
                    ? rawUrl.replaceFirst("https://image\\.tmdb\\.org/", "https://images.tmdb.org/")
                    : rawUrl;
                Request request = new Request.Builder().url(effectiveUrl).header("User-Agent", "BMovie/0.1 Android").build();
                try (Response response = httpClient().newCall(request).execute()) {
                    if (!response.isSuccessful() || response.body() == null) throw new IllegalStateException("图片预取失败 " + response.code());
                    response.body().bytes();
                    call.resolve();
                }
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "图片预取失败" : error.getMessage(), error);
            }
        }, "BMovieArtworkPrefetch").start();
    }

    public static WebResourceResponse interceptTmdbImage(Context context, String rawUrl) {
        try {
            URI uri = URI.create(rawUrl);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !TMDB_HOSTS.contains(uri.getHost()) || "api.themoviedb.org".equals(uri.getHost())) return null;
            initialize(context);
            refreshTmdbHostsAsync(context);
            // The singular CDN hostname is frequently reset by mainland ISPs.
            // The plural hostname serves the same TMDB path and is present in
            // both TMDB's CDN and the trusted CheckTMDB host list.
            String effectiveUrl = "image.tmdb.org".equals(uri.getHost())
                ? rawUrl.replaceFirst("https://image\\.tmdb\\.org/", "https://images.tmdb.org/")
                : rawUrl;
            Request request = new Request.Builder().url(effectiveUrl).header("User-Agent", "BMovie/0.1 Android").build();
            try (Response response = httpClient().newCall(request).execute()) {
                if (!response.isSuccessful() || response.body() == null) return null;
                byte[] bytes = response.body().bytes();
                String mime = response.body().contentType() == null ? "image/jpeg" : response.body().contentType().type() + "/" + response.body().contentType().subtype();
                Map<String, String> headers = new HashMap<>();
                for (String name : response.headers().names()) headers.put(name, response.header(name, ""));
                return new WebResourceResponse(mime, null, response.code(), response.message(), headers, new ByteArrayInputStream(bytes));
            }
        } catch (Exception ignored) {
            return null;
        }
    }

    private static void copyAllowedHeaders(JSObject headers, Request.Builder builder) {
        if (headers == null) return;
        Iterator<String> keys = headers.keys();
        while (keys.hasNext()) {
            String name = keys.next();
            if (!"authorization".equalsIgnoreCase(name) && !"content-type".equalsIgnoreCase(name) && !"cookie".equalsIgnoreCase(name)) continue;
            String value = headers.optString(name, "");
            if (!value.isEmpty()) builder.header(name, value);
        }
    }

    private static String decodeResponseBody(Response response) throws Exception {
        if (response.body() == null) return "";
        byte[] bytes = response.body().bytes();
        if (!"deflate".equalsIgnoreCase(response.header("Content-Encoding", ""))) {
            return new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
        }
        try {
            return inflate(bytes, false);
        } catch (Exception ignored) {
            return inflate(bytes, true);
        }
    }

    private static String inflate(byte[] bytes, boolean nowrap) throws Exception {
        Inflater inflater = new Inflater(nowrap);
        try (InflaterInputStream input = new InflaterInputStream(new ByteArrayInputStream(bytes), inflater);
             ByteArrayOutputStream output = new ByteArrayOutputStream(Math.max(1024, bytes.length * 2))) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            return output.toString(java.nio.charset.StandardCharsets.UTF_8.name());
        } finally {
            inflater.end();
        }
    }

    private static OkHttpClient httpClient() {
        if (client != null) return client;
        synchronized (NativeHttpPlugin.class) {
            if (client != null) return client;
            client = buildHttpClient(null);
            return client;
        }
    }

    private static OkHttpClient buildHttpClient(Cache cache) {
        Dns trustedDns = hostname -> {
            if (TMDB_HOSTS.contains(hostname)) return tmdbLookup(hostname);
            if ("api.bgm.tv".equals(hostname)) return bangumiLookup(hostname);
            return Dns.SYSTEM.lookup(hostname);
        };
        OkHttpClient.Builder builder = new OkHttpClient.Builder()
            .dns(trustedDns)
            .connectTimeout(7, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .callTimeout(24, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true);
        if (cache != null) builder.cache(cache);
        return builder.build();
    }

    private static List<InetAddress> tmdbLookup(String hostname) throws java.net.UnknownHostException {
        LinkedHashSet<InetAddress> candidates = new LinkedHashSet<>(tmdbAddresses.getOrDefault(hostname, new ArrayList<>()));
        try { candidates.addAll(Dns.SYSTEM.lookup(hostname)); } catch (Exception ignored) {}
        if (candidates.isEmpty()) throw new java.net.UnknownHostException(hostname);
        return new ArrayList<>(candidates);
    }

    private static List<InetAddress> bangumiLookup(String hostname) throws java.net.UnknownHostException {
        if (bangumiAddresses != null && !bangumiAddresses.isEmpty()) return bangumiAddresses;
        synchronized (NativeHttpPlugin.class) {
            if (bangumiAddresses != null && !bangumiAddresses.isEmpty()) return bangumiAddresses;
            try { bangumiAddresses = resolveWithCloudflare(hostname); } catch (Exception ignored) { bangumiAddresses = Dns.SYSTEM.lookup(hostname); }
            return bangumiAddresses;
        }
    }

    private static synchronized void initialize(Context context) {
        if (!initialized.compareAndSet(false, true)) return;
        SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        parseHostList(preferences.getString(PREFS_TMDB_HOSTS, ""));
        try {
            Cache cache = new Cache(new File(context.getCacheDir(), "metadata-images"), 96L * 1024L * 1024L);
            client = buildHttpClient(cache);
        } catch (Exception ignored) {
            client = buildHttpClient(null);
        }
    }

    private static void refreshTmdbHostsAsync(Context context) {
        if (!refreshStarted.compareAndSet(false, true)) return;
        new Thread(() -> {
            OkHttpClient refreshClient = new OkHttpClient.Builder()
                .connectTimeout(5, TimeUnit.SECONDS)
                .readTimeout(7, TimeUnit.SECONDS)
                .callTimeout(10, TimeUnit.SECONDS)
                .build();
            Request request = new Request.Builder().url(CHECK_TMDB_URL).header("User-Agent", "BMovie/0.1 Android").build();
            try (Response response = refreshClient.newCall(request).execute()) {
                if (!response.isSuccessful() || response.body() == null) return;
                String hosts = response.body().string();
                if (parseHostList(hosts)) context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().putString(PREFS_TMDB_HOSTS, hosts).apply();
            } catch (Exception ignored) {
                // Bundled and previously cached candidates remain available.
            }
        }, "BMovieCheckTMDB").start();
    }

    private static boolean parseHostList(String contents) {
        if (contents == null || contents.isEmpty()) return false;
        Matcher matcher = HOST_LINE.matcher(contents);
        boolean found = false;
        while (matcher.find()) {
            String address = matcher.group(1);
            if (!isPublicIpv4(address)) continue;
            putAddress(matcher.group(2), address);
            found = true;
        }
        return found;
    }

    private static boolean isPublicIpv4(String value) {
        String[] parts = value.split("\\.");
        if (parts.length != 4) return false;
        int[] octets = new int[4];
        try {
            for (int index = 0; index < 4; index++) {
                octets[index] = Integer.parseInt(parts[index]);
                if (octets[index] < 0 || octets[index] > 255) return false;
            }
        } catch (NumberFormatException error) { return false; }
        return octets[0] != 0 && octets[0] != 10 && octets[0] != 127 && octets[0] < 224
            && !(octets[0] == 169 && octets[1] == 254)
            && !(octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
            && !(octets[0] == 192 && octets[1] == 168);
    }

    private static void putAddress(String hostname, String address) {
        try {
            InetAddress parsed = InetAddress.getByName(address);
            List<InetAddress> current = new ArrayList<>(tmdbAddresses.getOrDefault(hostname, new ArrayList<>()));
            if (!current.contains(parsed)) current.add(0, parsed);
            tmdbAddresses.put(hostname, current);
        } catch (Exception ignored) {}
    }

    private static List<InetAddress> resolveWithCloudflare(String hostname) throws Exception {
        OkHttpClient resolver = new OkHttpClient.Builder().callTimeout(6, TimeUnit.SECONDS).build();
        String url = "https://cloudflare-dns.com/dns-query?name=" + URLEncoder.encode(hostname, "UTF-8") + "&type=A";
        Request request = new Request.Builder().url(url).header("Accept", "application/dns-json").build();
        ArrayList<InetAddress> addresses = new ArrayList<>();
        try (Response response = resolver.newCall(request).execute()) {
            if (!response.isSuccessful() || response.body() == null) throw new IllegalStateException("安全 DNS 查询失败");
            JSONArray answers = new JSONObject(response.body().string()).optJSONArray("Answer");
            if (answers != null) {
                for (int index = 0; index < answers.length(); index++) {
                    JSONObject answer = answers.optJSONObject(index);
                    if (answer != null && answer.optInt("type") == 1) addresses.add(InetAddress.getByName(answer.optString("data")));
                }
            }
        }
        if (addresses.isEmpty()) throw new IllegalStateException("安全 DNS 没有返回地址");
        return addresses;
    }
}
