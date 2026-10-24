/** Static export: `npm run build` writes plain HTML/JS/CSS to web/out, which the FastAPI hub serves
 * offline, exactly like the old apps/ folder. Every route keeps its old URL (passenger.html, crew.html …),
 * so printed seat QR codes still work. */
const nextConfig = {
  output: "export",
  trailingSlash: false,
  images: { unoptimized: true },
  reactStrictMode: false,
  poweredByHeader: false,
};
export default nextConfig;
