package in.reflow.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The WebView ignores browser downloads (<a download>), so pages
        // that export a file hand it to window.ReFlowFiles instead.
        getBridge().getWebView().addJavascriptInterface(new FileSaver(), "ReFlowFiles");
    }

    /** Saves text files made by the web app, e.g. the OCEMS CSV export. */
    private class FileSaver {
        private static final int MAX_CHARS = 25 * 1024 * 1024;

        /**
         * Android 10+: saved to the Downloads folder. Older versions need a
         * storage permission for that, so the share sheet opens instead.
         * Returns "saved", "shared" or "error".
         */
        @JavascriptInterface
        public String saveText(String name, String mimeType, String content) {
            if (content == null || content.length() > MAX_CHARS) return "error";
            String fileName = safeName(name);
            String mime = "text/plain".equals(mimeType) ? "text/plain" : "text/csv";
            byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    saveToDownloads(fileName, mime, bytes);
                    toast("Saved to Downloads: " + fileName);
                    return "saved";
                }
                share(fileName, mime, bytes);
                return "shared";
            } catch (Exception e) {
                toast("Couldn't save the file.");
                return "error";
            }
        }

        private void saveToDownloads(String fileName, String mime, byte[] bytes) throws Exception {
            ContentResolver resolver = getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IllegalStateException("insert failed");
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new IllegalStateException("no output stream");
                out.write(bytes);
            } catch (Exception e) {
                resolver.delete(uri, null, null);
                throw e;
            }
            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(uri, values, null, null);
        }

        private void share(String fileName, String mime, byte[] bytes) throws Exception {
            File dir = new File(getCacheDir(), "exports");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IllegalStateException("no cache dir");
            File file = new File(dir, fileName);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(bytes);
            }
            Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND)
                .setType(mime)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            runOnUiThread(() -> startActivity(Intent.createChooser(send, fileName)));
        }

        private String safeName(String name) {
            String clean = String.valueOf(name == null ? "" : name).replaceAll("[^A-Za-z0-9._-]", "_");
            clean = clean.replaceAll("^[._]+", "");
            if (clean.length() > 120) clean = clean.substring(clean.length() - 120);
            return clean.isEmpty() ? "reflow-download.csv" : clean;
        }

        private void toast(String message) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show());
        }
    }
}
