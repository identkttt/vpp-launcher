import javax.imageio.ImageIO;
import java.awt.AlphaComposite;
import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.RadialGradientPaint;
import java.awt.RenderingHints;
import java.awt.geom.Point2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.File;

/**
 * The app icon: the mark, tinted with the accent the way the loader tints it
 * (multiply, a touch brighter), on a dark rounded square with the accent's glow behind it.
 * usage: java scripts/MakeIcon.java [logo.png] [out.png]
 */
public class MakeIcon {
    public static void main(String[] args) throws Exception {
        File logoFile = new File(args.length > 0 ? args[0] : "src/renderer/assets/logo.png");
        File out = new File(args.length > 1 ? args[1] : "build/icon.png");
        int size = 512;
        float[] accent = {186 / 255f, 171 / 255f, 251 / 255f};

        BufferedImage icon = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = icon.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);

        RoundRectangle2D.Float tile = new RoundRectangle2D.Float(16, 16, size - 32, size - 32, 112, 112);
        g.setPaint(new GradientPaint(0, 16, new Color(0x1d1a26), 0, size - 16, new Color(0x09090c)));
        g.fill(tile);
        g.setClip(tile);
        g.setPaint(new RadialGradientPaint(new Point2D.Float(size * 0.5f, size * 0.46f), size * 0.42f,
                new float[]{0f, 1f}, new Color[]{new Color(186, 171, 251, 70), new Color(186, 171, 251, 0)}));
        g.fillRect(0, 0, size, size);
        g.setClip(null);
        g.setColor(new Color(255, 255, 255, 18));
        g.draw(new RoundRectangle2D.Float(16.5f, 16.5f, size - 33, size - 33, 112, 112));

        BufferedImage logo = ImageIO.read(logoFile);
        BufferedImage tinted = new BufferedImage(logo.getWidth(), logo.getHeight(), BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < logo.getHeight(); y++) {
            for (int x = 0; x < logo.getWidth(); x++) {
                int p = logo.getRGB(x, y);
                int a = p >>> 24;
                if (a == 0) continue;
                float r = ((p >> 16) & 255) / 255f, gr = ((p >> 8) & 255) / 255f, b = (p & 255) / 255f;
                int nr = Math.min(255, Math.round(r * accent[0] * 1.2f * 255));
                int ng = Math.min(255, Math.round(gr * accent[1] * 1.2f * 255));
                int nb = Math.min(255, Math.round(b * accent[2] * 1.2f * 255));
                tinted.setRGB(x, y, (a << 24) | (nr << 16) | (ng << 8) | nb);
            }
        }
        int box = Math.round(size * 0.66f);
        float scale = Math.min(box / (float) logo.getWidth(), box / (float) logo.getHeight());
        int w = Math.round(logo.getWidth() * scale), h = Math.round(logo.getHeight() * scale);
        g.setComposite(AlphaComposite.SrcOver);
        g.drawImage(tinted, (size - w) / 2, (size - h) / 2, w, h, null);
        g.dispose();

        out.getAbsoluteFile().getParentFile().mkdirs();
        ImageIO.write(icon, "png", out);
        System.out.println("wrote " + out);
    }
}
