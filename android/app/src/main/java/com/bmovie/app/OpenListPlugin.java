package com.bmovie.app;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import org.json.JSONObject;

/**
 * Runs the bundled OpenList (Alist v3-compatible) server as a child process.
 *
 * The Go binary ships inside the APK as jniLibs/arm64-v8a/libopenlist.so with
 * useLegacyPackaging enabled, so the installer extracts it to nativeLibraryDir —
 * the only location a modern Android app is allowed to exec from.
 */
@CapacitorPlugin(name = "OpenList")
public class OpenListPlugin extends Plugin {

    private static final String TAG = "OpenListPlugin";
    private static final String BINARY_NAME = "libopenlist.so";

    private Process process;
    private Thread logThread;

    @PluginMethod
    public void start(PluginCall call) {
        if (isRunning()) {
            call.resolve(statusObject(true));
            return;
        }
        try {
            String binary = new File(getContext().getApplicationInfo().nativeLibraryDir, BINARY_NAME).getAbsolutePath();
            File dataDir = new File(getContext().getFilesDir(), "openlist");
            if (!dataDir.exists() && !dataDir.mkdirs()) {
                call.reject("Cannot create data directory: " + dataDir);
                return;
            }

            List<String> command = new ArrayList<>();
            command.add(binary);
            command.add("server");
            command.add("--data");
            command.add(dataDir.getAbsolutePath());

            File configFile = new File(dataDir, "config.json");
            boolean firstRun = !configFile.exists();
            if (!firstRun) hardenConfig(configFile);

            process = launch(command);
            pipeLogs();

            // OpenList creates its default configuration itself. Let the first boot
            // finish its migrations, then bind the real long-lived process to loopback.
            if (firstRun && waitForPing(15_000) && configFile.exists()) {
                process.destroy();
                process.waitFor();
                hardenConfig(configFile);
                process = launch(command);
                pipeLogs();
            }

            call.resolve(statusObject(true));
        } catch (Exception e) {
            Log.e(TAG, "Failed to start OpenList", e);
            call.reject("Failed to start OpenList: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (process != null) {
            process.destroy();
            process = null;
        }
        call.resolve(statusObject(false));
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(statusObject(isRunning()));
    }

    /** Reset the admin password; used by first-run setup so the app can log itself in. */
    @PluginMethod
    public void setAdminPassword(PluginCall call) {
        String password = call.getString("password");
        if (password == null || password.isEmpty()) {
            call.reject("password is required");
            return;
        }
        try {
            String binary = new File(getContext().getApplicationInfo().nativeLibraryDir, BINARY_NAME).getAbsolutePath();
            File dataDir = new File(getContext().getFilesDir(), "openlist");
            Process p = new ProcessBuilder(
                binary, "admin", "set", password, "--data", dataDir.getAbsolutePath()
            ).redirectErrorStream(true).start();
            int exitCode = p.waitFor();
            if (exitCode != 0) {
                call.reject("OpenList admin command failed with exit code " + exitCode);
                return;
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to set admin password: " + e.getMessage());
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (process != null) {
            process.destroy();
            process = null;
        }
    }

    private boolean isRunning() {
        return process != null && process.isAlive();
    }

    private JSObject statusObject(boolean running) {
        JSObject result = new JSObject();
        result.put("running", running);
        result.put("baseUrl", "http://127.0.0.1:5244");
        return result;
    }

    private void pipeLogs() {
        logThread = new Thread(() -> {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    Log.i(TAG, line);
                }
            } catch (Exception ignored) {
                // Stream closes when the process exits.
            }
        }, "openlist-log");
        logThread.setDaemon(true);
        logThread.start();
    }

    private Process launch(List<String> command) throws Exception {
        return new ProcessBuilder(command).redirectErrorStream(true).start();
    }

    private boolean waitForPing(long timeoutMs) {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            try {
                HttpURLConnection connection = (HttpURLConnection) new URL("http://127.0.0.1:5244/ping").openConnection();
                connection.setConnectTimeout(500);
                connection.setReadTimeout(500);
                if (connection.getResponseCode() == 200) return true;
            } catch (Exception ignored) {
                // Service is still booting.
            }
            try { Thread.sleep(200); } catch (InterruptedException e) { return false; }
        }
        return false;
    }

    private void hardenConfig(File configFile) throws Exception {
        byte[] bytes;
        try (FileInputStream input = new FileInputStream(configFile)) {
            bytes = new byte[(int) configFile.length()];
            int offset = 0;
            while (offset < bytes.length) {
                int count = input.read(bytes, offset, bytes.length - offset);
                if (count < 0) break;
                offset += count;
            }
        }
        JSONObject config = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        config.getJSONObject("scheme").put("address", "127.0.0.1");
        JSONObject log = config.getJSONObject("log");
        log.put("max_size", 10);
        log.put("max_backups", 3);
        try (FileOutputStream output = new FileOutputStream(configFile, false)) {
            output.write(config.toString(2).getBytes(StandardCharsets.UTF_8));
        }
    }
}
