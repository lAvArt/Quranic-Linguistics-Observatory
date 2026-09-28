"use client";

import { createContext, useContext, useState, ReactNode, useCallback, useEffect, useSyncExternalStore } from "react";

type MobileSurface = "none" | "context" | "tools" | "search" | "nav" | "settings";

interface VizControlContextType {
    activeMobileSurface: MobileSurface;
    isMobileViewport: boolean;
    isLeftSidebarOpen: boolean;
    isRightSidebarOpen: boolean;
    isMobileNavOpen: boolean;
    isMobileSearchOpen: boolean;
    isMobileSettingsOpen: boolean;
    closeMobileSurface: () => void;
    openMobileSurface: (surface: Exclude<MobileSurface, "none">) => void;
    toggleMobileSurface: (surface: Exclude<MobileSurface, "none">) => void;
    toggleLeftSidebar: () => void;
    toggleRightSidebar: () => void;
    toggleMobileNav: () => void;
    toggleMobileSearch: () => void;
    setLeftSidebarOpen: (isOpen: boolean) => void;
    setRightSidebarOpen: (isOpen: boolean) => void;
    setMobileNavOpen: (isOpen: boolean) => void;
    setMobileSearchOpen: (isOpen: boolean) => void;
    setMobileSettingsOpen: (isOpen: boolean) => void;
}

const VizControlContext = createContext<VizControlContextType | undefined>(undefined);

// Must match the CSS breakpoint every shell piece switches layout at (980px),
// or 901–980px gets desktop panel state inside a phone layout.
const MOBILE_QUERY = "(max-width: 980px)";

function subscribeMobileQuery(cb: () => void) {
    const mql = window.matchMedia(MOBILE_QUERY);
    mql.addEventListener("change", cb);
    return () => mql.removeEventListener("change", cb);
}

function getMobileSnapshot() {
    return window.matchMedia(MOBILE_QUERY).matches;
}

function getMobileServerSnapshot() {
    return false; // SSR assumes desktop
}

export function VizControlProvider({ children }: { children: ReactNode }) {
    const isMobileViewport = useSyncExternalStore(subscribeMobileQuery, getMobileSnapshot, getMobileServerSnapshot);

    // Desktop: left sidebar open by default; mobile: closed
    const [activeMobileSurface, setActiveMobileSurface] = useState<MobileSurface>("none");
    const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
    const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);

    // Close sidebars when switching to mobile viewport
    useEffect(() => {
        if (isMobileViewport) {
            setIsLeftSidebarOpen(false);
            setIsRightSidebarOpen(false);
            setActiveMobileSurface("none");
        }
    }, [isMobileViewport]);

    const closeMobileSurface = useCallback(() => {
        setActiveMobileSurface("none");
        setIsLeftSidebarOpen(false);
        setIsRightSidebarOpen(false);
    }, []);

    const openMobileSurface = useCallback((surface: Exclude<MobileSurface, "none">) => {
        setActiveMobileSurface(surface);
        setIsLeftSidebarOpen(surface === "context");
        setIsRightSidebarOpen(surface === "tools");
    }, []);

    const toggleMobileSurface = useCallback((surface: Exclude<MobileSurface, "none">) => {
        setActiveMobileSurface((prev) => {
            const next = prev === surface ? "none" : surface;
            setIsLeftSidebarOpen(next === "context");
            setIsRightSidebarOpen(next === "tools");
            return next;
        });
    }, []);

    const setLeftSidebarOpen = useCallback((isOpen: boolean) => {
        if (isMobileViewport) {
            if (isOpen) {
                openMobileSurface("context");
                return;
            }
            if (activeMobileSurface === "context") {
                closeMobileSurface();
            }
            return;
        }

        setIsLeftSidebarOpen(isOpen);
    }, [activeMobileSurface, closeMobileSurface, isMobileViewport, openMobileSurface]);

    const setRightSidebarOpen = useCallback((isOpen: boolean) => {
        if (isMobileViewport) {
            if (isOpen) {
                openMobileSurface("tools");
                return;
            }
            if (activeMobileSurface === "tools") {
                closeMobileSurface();
            }
            return;
        }

        setIsRightSidebarOpen(isOpen);
    }, [activeMobileSurface, closeMobileSurface, isMobileViewport, openMobileSurface]);

    const setMobileNavOpen = useCallback((isOpen: boolean) => {
        if (!isMobileViewport) return;
        if (isOpen) {
            openMobileSurface("nav");
            return;
        }
        if (activeMobileSurface === "nav") {
            closeMobileSurface();
        }
    }, [activeMobileSurface, closeMobileSurface, isMobileViewport, openMobileSurface]);

    const setMobileSearchOpen = useCallback((isOpen: boolean) => {
        if (!isMobileViewport) return;
        if (isOpen) {
            openMobileSurface("search");
            return;
        }
        if (activeMobileSurface === "search") {
            closeMobileSurface();
        }
    }, [activeMobileSurface, closeMobileSurface, isMobileViewport, openMobileSurface]);

    const setMobileSettingsOpen = useCallback((isOpen: boolean) => {
        if (!isMobileViewport) return;
        if (isOpen) {
            openMobileSurface("settings");
            return;
        }
        if (activeMobileSurface === "settings") {
            closeMobileSurface();
        }
    }, [activeMobileSurface, closeMobileSurface, isMobileViewport, openMobileSurface]);

    const toggleLeftSidebar = useCallback(() => {
        if (isMobileViewport) {
            toggleMobileSurface("context");
            return;
        }
        setIsLeftSidebarOpen(prev => !prev);
    }, [isMobileViewport, toggleMobileSurface]);

    const toggleRightSidebar = useCallback(() => {
        if (isMobileViewport) {
            toggleMobileSurface("tools");
            return;
        }
        setIsRightSidebarOpen(prev => !prev);
    }, [isMobileViewport, toggleMobileSurface]);

    const toggleMobileNav = useCallback(() => {
        if (!isMobileViewport) return;
        toggleMobileSurface("nav");
    }, [isMobileViewport, toggleMobileSurface]);

    const toggleMobileSearch = useCallback(() => {
        if (!isMobileViewport) return;
        toggleMobileSurface("search");
    }, [isMobileViewport, toggleMobileSurface]);

    const isMobileNavOpen = activeMobileSurface === "nav";
    const isMobileSearchOpen = activeMobileSurface === "search";
    const isMobileSettingsOpen = activeMobileSurface === "settings";

    return (
        <VizControlContext.Provider
            value={{
                activeMobileSurface,
                isMobileViewport,
                isLeftSidebarOpen,
                isRightSidebarOpen,
                isMobileNavOpen,
                isMobileSearchOpen,
                isMobileSettingsOpen,
                closeMobileSurface,
                openMobileSurface,
                toggleMobileSurface,
                toggleLeftSidebar,
                toggleRightSidebar,
                toggleMobileNav,
                toggleMobileSearch,
                setLeftSidebarOpen,
                setRightSidebarOpen,
                setMobileNavOpen,
                setMobileSearchOpen,
                setMobileSettingsOpen,
            }}
        >
            {children}
        </VizControlContext.Provider>
    );
}

export function useVizControl() {
    const context = useContext(VizControlContext);
    if (context === undefined) {
        throw new Error("useVizControl must be used within a VizControlProvider");
    }
    return context;
}
