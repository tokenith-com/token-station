"use client";

import { createContext, useContext } from "react";
import type { Portal } from "./portal";

export const PortalContext = createContext<Portal>("b");
export const usePortal = () => useContext(PortalContext);
