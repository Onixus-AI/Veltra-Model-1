import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers(){return [{source:'/:path*',headers:[
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
    {key:'Content-Security-Policy',value:"frame-ancestors 'self'"},
    {key:'Permissions-Policy',value:'camera=(), geolocation=(), microphone=(self)'},
  ]}];},
  outputFileTracingRoot: path.resolve(__dirname),
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;

