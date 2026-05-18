import { useState, useEffect, useRef, useCallback } from "react";
import { runFaultDetection } from "../faultEngine";

export function useFaultDetection({
  replayDataRef,
  pvDataRef,
  climateReplayDataRef,
  currentFrame,
  outsideTempRef,
  tariff = 0.22,
  demandCharge = 8.50,
  enabled = true,
}) {
  const [faults, setFaults] = useState([]);
  const [summary, setSummary] = useState(null);
  const [faultHistory, setFaultHistory] = useState([]);
  const prevFrameRef = useRef(-1);
  const historyRef = useRef([]);

  useEffect(() => {
    if (!enabled) return;
    if (currentFrame === prevFrameRef.current) return;
    prevFrameRef.current = currentFrame;

    try {
      const tempSeries = outsideTempRef?.current ?? [];
      const now = new Date();
      const currentHour = now.getHours() + now.getMinutes() / 60;
      let outsideTemp = 20;
      if (tempSeries.length > 0) {
        const closest = tempSeries.reduce((best, entry) => {
          return Math.abs((entry.hour ?? 0) - currentHour) < Math.abs((best.hour ?? 0) - currentHour)
            ? entry : best;
        }, tempSeries[0]);
        outsideTemp = closest.temp ?? 20;
      }

      const result = runFaultDetection({
        replayData: replayDataRef?.current ?? {},
        pvData: pvDataRef?.current ?? {},
        climateData: { rooms: climateReplayDataRef?.current ?? {} },
        currentFrame,
        outsideTemp,
        tariff,
        demandCharge,
      });

      setFaults(result.active);
      setSummary(result.summary);

      if (result.active.length > 0) {
        const newEntries = result.active.map((f) => ({ ...f, frameIdx: currentFrame }));
        historyRef.current = [...historyRef.current, ...newEntries].slice(-500);
        setFaultHistory([...historyRef.current]);
      }
    } catch (err) {
      console.warn("Fault detection error:", err);
    }
  }, [currentFrame, enabled]);

  const clearHistory = useCallback(() => {
    historyRef.current = [];
    setFaultHistory([]);
  }, []);

  return { faults, summary, faultHistory, clearHistory };
}
