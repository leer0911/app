import type { CracoConfig } from "@craco/types";
import path from "path";

const CracoLess = require("craco-less");
const CracoCSSModules = require("craco-css-modules");

const cracoConfig: CracoConfig = {
  webpack: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  plugins: [{ plugin: CracoLess }, { plugin: CracoCSSModules }],
};

export default cracoConfig;
