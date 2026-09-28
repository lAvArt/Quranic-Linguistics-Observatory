import { useCallback, useEffect, useRef } from "react";
import * as d3 from "@/lib/viz/d3";
import { fitGraphToView, fitBoundsToView, type ViewBounds } from "@/lib/viz/fitToView";
import { motionSafeDuration } from "@/lib/viz/motionPrefs";

interface ZoomOptions {
    minScale?: number;
    maxScale?: number;
    initialScale?: number;
    /** Extra dependency to re-trigger zoom setup (e.g. set to true once the SVG is mounted). */
    ready?: unknown;
    /** Every tick. `event` is d3's zoom event (its `sourceEvent` is null for a programmatic fit). */
    onZoom?: (transform: d3.ZoomTransform, event?: d3.D3ZoomEvent<SVGSVGElement, unknown>) => void;
    onZoomEnd?: (transform: d3.ZoomTransform) => void;
    /** d3's double-click/double-tap zoom. Off for a view whose clicks toggle
     *  something, where a double click would toggle it twice. */
    doubleClickZoom?: boolean;
}

export function useZoom<SVGType extends SVGSVGElement>({
    minScale = 0.5,
    maxScale = 8,
    initialScale = 1,
    ready,
    onZoom,
    onZoomEnd,
    doubleClickZoom = true,
}: ZoomOptions = {}) {
    const svgRef = useRef<SVGType>(null);
    const gRef = useRef<SVGGElement>(null);
    const onZoomRef = useRef<ZoomOptions["onZoom"]>(onZoom);
    const onZoomEndRef = useRef<ZoomOptions["onZoomEnd"]>(onZoomEnd);
    const zoomInstanceRef = useRef<d3.ZoomBehavior<SVGType, unknown> | null>(null);

    useEffect(() => {
        onZoomRef.current = onZoom;
        onZoomEndRef.current = onZoomEnd;
    }, [onZoom, onZoomEnd]);

    useEffect(() => {
        if (!svgRef.current || !gRef.current) return;

        // Prevent browser from intercepting touch gestures (pinch-to-zoom)
        svgRef.current.style.touchAction = "none";

        const zoom = d3
            .zoom<SVGType, unknown>()
            .scaleExtent([minScale, maxScale])
            .on("zoom", (event) => {
                d3.select(gRef.current).attr("transform", event.transform);
                onZoomRef.current?.(event.transform, event);
            });

        zoomInstanceRef.current = zoom;

        zoom.on("end", (event) => {
            onZoomEndRef.current?.(event.transform);
        });

        const svgSelection = d3.select(svgRef.current);
        svgSelection.call(zoom);
        if (!doubleClickZoom) svgSelection.on("dblclick.zoom", null);

        // Set initial zoom
        svgSelection.call(
            zoom.transform,
            d3.zoomIdentity.translate(0, 0).scale(initialScale)
        );
        onZoomRef.current?.(d3.zoomIdentity.translate(0, 0).scale(initialScale));

        return () => {
            svgSelection.on(".zoom", null);
        };
    }, [minScale, maxScale, initialScale, ready, doubleClickZoom]);

    // Camera transitions consult reduced-motion AT THE SOURCE (durations
    // collapse to 0), so every visualization built on this hook honors the
    // preference without per-call-site wrapping. fitToView/fitBounds get the
    // same treatment inside fitBoundsToView.
    const resetZoom = () => {
        if (svgRef.current && zoomInstanceRef.current) {
            d3.select(svgRef.current)
                .transition()
                .duration(motionSafeDuration(750))
                .call(zoomInstanceRef.current.transform, d3.zoomIdentity.translate(0, 0).scale(initialScale));
            onZoomRef.current?.(d3.zoomIdentity.translate(0, 0).scale(initialScale));
        }
    };

    const zoomBy = (factor: number) => {
        if (svgRef.current && zoomInstanceRef.current) {
            d3.select(svgRef.current)
                .transition()
                .duration(motionSafeDuration(200))
                .call(zoomInstanceRef.current.scaleBy, factor);
        }
    };

    /**
     * Frame the ENTIRE rendered graph in the viewport (zoom-to-fit), rather than
     * resetting to the origin which can crop or zoom into the middle. Measures the
     * content's bounding box and centres it with a little breathing room.
     */
    const fitToView = (padding = 0.88) => {
        fitGraphToView(svgRef.current, gRef.current, zoomInstanceRef.current, {
            padding,
            minScale,
            maxScale,
        });
    };

    /**
     * Frame an explicit region instead of the whole graph — used to snap the
     * camera onto whatever an initial deep-linked focus made relevant, once
     * real layout positions exist, without waiting on/disturbing the rest of
     * the graph. Memoized so it can safely sit in a caller's effect deps.
     */
    const fitBounds = useCallback(
        (bounds: ViewBounds, opts: { padding?: number; duration?: number } = {}) => {
            fitBoundsToView(svgRef.current, bounds, zoomInstanceRef.current, {
                padding: opts.padding ?? 0.88,
                duration: opts.duration,
                minScale,
                maxScale,
            });
        },
        [minScale, maxScale]
    );

    return { svgRef, gRef, resetZoom, fitToView, fitBounds, zoomBy };
}
