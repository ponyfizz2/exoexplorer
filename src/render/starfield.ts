/**
 * Parallax starfield + volumetric nebula backdrop, drawn on a single canvas.
 *
 * Three depth layers drift at different rates so the field feels like space
 * rather than a texture, and the whole thing stops when the tab is hidden or the
 * user has asked for reduced motion.
 */

interface Star { x: number; y: number; z: number; r: number; a: number; da: number; hue: number }
interface Nebula { x: number; y: number; r: number; hue: number; alpha: number }

const LAYERS = [
  { depth: 0.4, count: 0.00009, size: 0.55, alpha: 0.45 },  // far dust
  { depth: 1.0, count: 0.00007, size: 0.95, alpha: 0.8 },   // mid field
  { depth: 2.4, count: 0.00002, size: 1.7, alpha: 1.0 },    // near, bright
];

export class Starfield {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private stars: Star[] = [];
  private nebulae: Nebula[] = [];
  private width = 0;
  private height = 0;
  private raf = 0;
  private running = false;
  private drift = 0;
  private parallax = { x: 0, y: 0, tx: 0, ty: 0 };
  private reduced = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.resize();
    window.addEventListener("resize", this.resize);
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibility);
    this.start();
  }

  private onPointerMove = (event: PointerEvent): void => {
    this.parallax.tx = (event.clientX / this.width - 0.5) * 2;
    this.parallax.ty = (event.clientY / this.height - 0.5) * 2;
  };

  private onVisibility = (): void => {
    if (document.hidden) this.stop();
    else this.start();
  };

  private resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.seed();
  };

  private seed(): void {
    const area = this.width * this.height;
    this.stars = [];
    for (const layer of LAYERS) {
      const count = Math.min(1400, Math.round(area * layer.count));
      for (let i = 0; i < count; i += 1) {
        this.stars.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          z: layer.depth * (0.85 + Math.random() * 0.3),
          r: layer.size * (0.4 + Math.random() * 0.9),
          a: Math.random() * layer.alpha,
          da: (Math.random() - 0.5) * 0.012,
          hue: Math.random() < 0.12 ? 200 + Math.random() * 40 : Math.random() < 0.2 ? 30 + Math.random() * 25 : 0,
        });
      }
    }
    this.nebulae = [];
    const nebulaCount = window.innerWidth < 768 ? 3 : 6;
    for (let i = 0; i < nebulaCount; i += 1) {
      this.nebulae.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        r: Math.max(this.width, this.height) * (0.18 + Math.random() * 0.35),
        hue: [265, 190, 220, 300][Math.floor(Math.random() * 4)],
        alpha: 0.05 + Math.random() * 0.07,
      });
    }
  }

  private drawBackground(): void {
    const g = this.ctx.createLinearGradient(0, 0, this.width * 0.3, this.height);
    g.addColorStop(0, "#04060f");
    g.addColorStop(0.45, "#060512");
    g.addColorStop(1, "#02030a");
    this.ctx.fillStyle = g;
    this.ctx.fillRect(0, 0, this.width, this.height);

    this.ctx.globalCompositeOperation = "screen";
    const px = this.parallax.x * 14;
    const py = this.parallax.y * 14;
    for (const n of this.nebulae) {
      const grad = this.ctx.createRadialGradient(n.x + px, n.y + py, 0, n.x + px, n.y + py, n.r);
      grad.addColorStop(0, `hsla(${n.hue}, 90%, 60%, ${n.alpha})`);
      grad.addColorStop(0.5, `hsla(${n.hue}, 90%, 45%, ${n.alpha * 0.35})`);
      grad.addColorStop(1, "hsla(240, 90%, 30%, 0)");
      this.ctx.fillStyle = grad;
      this.ctx.beginPath();
      this.ctx.arc(n.x + px, n.y + py, n.r, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.globalCompositeOperation = "source-over";
  }

  private frame = (): void => {
    const ctx = this.ctx;
    this.drawBackground();

    this.parallax.x += (this.parallax.tx - this.parallax.x) * 0.045;
    this.parallax.y += (this.parallax.ty - this.parallax.y) * 0.045;

    if (!this.reduced) this.drift += 0.0006;

    ctx.globalCompositeOperation = "lighter";
    for (const star of this.stars) {
      if (!this.reduced) {
        star.y -= star.z * 0.055;
        star.a += star.da;
        if (star.a < 0.05 || star.a > 0.95) { star.da *= -1; star.a = Math.max(0.05, Math.min(0.95, star.a)); }
        if (star.y < -4) { star.y = this.height + 4; star.x = Math.random() * this.width; }
      }
      const x = star.x + this.parallax.x * star.z * 9;
      const y = star.y + this.parallax.y * star.z * 9;
      const twinkle = 0.85 + 0.15 * Math.sin(this.drift * 60 * star.z + star.x);
      ctx.globalAlpha = Math.max(0, star.a * twinkle);
      ctx.fillStyle = star.hue ? `hsl(${star.hue}, 85%, 78%)` : "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, star.r, 0, Math.PI * 2);
      ctx.fill();
      if (star.r > 1.35) {
        ctx.globalAlpha = Math.max(0, star.a * 0.18);
        ctx.beginPath();
        ctx.arc(x, y, star.r * 3.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    this.raf = requestAnimationFrame(this.frame);
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    this.stop();
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("pointermove", this.onPointerMove);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }
}
