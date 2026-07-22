import { useState, useCallback, useRef, useEffect } from 'react';
import { AttendanceShadowService } from '../services/attendanceShadowService';
import { AttendanceShadowRequest, AttendanceShadowResponse } from '../types/phase5d2';

export interface UseAttendanceShadowReturn {
  response: AttendanceShadowResponse | null;
  loading: boolean;
  error: string | null;
  execute: (params: Omit<AttendanceShadowRequest, 'requestId' | 'cursor'>) => Promise<void>;
  nextPage: () => Promise<void>;
  previousPage: () => Promise<void>;
  reset: () => void;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export function useAttendanceShadow(): UseAttendanceShadowReturn {
  const [response, setResponse] = useState<AttendanceShadowResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Keep track of the active request logical ID
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  
  // The original filters used for the current session
  const [currentParams, setCurrentParams] = useState<Omit<AttendanceShadowRequest, 'requestId' | 'cursor'> | null>(null);
  
  // Pagination stack
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([]);

  // Concurrency control: keeps track of the latest logical operation
  // Prevents stale responses from overriding newer requests
  const requestSequenceRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      requestSequenceRef.current += 1;
    };
  }, []);

  const reset = useCallback(() => {
    requestSequenceRef.current += 1; // Invalidate any pending requests
    setResponse(null);
    setError(null);
    setLoading(false);
    setActiveRequestId(null);
    setCurrentParams(null);
    setCursorStack([]);
  }, []);

  const executeCore = async (
    params: Omit<AttendanceShadowRequest, 'requestId' | 'cursor'>, 
    cursor: string | null, 
    reqId: string,
    newStack: (string | null)[]
  ) => {
    const sequence = ++requestSequenceRef.current;
    
    setLoading(true);
    setError(null);
    
    try {
      const callParams: Omit<AttendanceShadowRequest, 'requestId'> = { ...params };
      if (cursor) {
        callParams.cursor = cursor;
      }
      
      const res = await AttendanceShadowService.execute(callParams, reqId);
      
      if (sequence !== requestSequenceRef.current) {
        return;
      }
      
      setResponse(res);
      setActiveRequestId(reqId);
      setCurrentParams(params);
      setCursorStack(newStack);
      
    } catch (err: any) {
      if (sequence !== requestSequenceRef.current) {
        return;
      }
      setError(err.message || 'Error desconocido.');
    } finally {
      if (sequence === requestSequenceRef.current) {
        setLoading(false);
      }
    }
  };

  const execute = useCallback(async (params: Omit<AttendanceShadowRequest, 'requestId' | 'cursor'>) => {
    // A new query starts a brand new logic sequence with a new requestId and empty cursor stack
    const reqId = AttendanceShadowService.generateRequestId();
    await executeCore(params, null, reqId, [null]);
  }, []);

  const nextPage = useCallback(async () => {
    if (!response || !currentParams || !activeRequestId) return;
    
    // We get the next cursor from the legacyResult (since legacy is the source of truth for pagination in shadow reads)
    const nextCursor = response.legacyResult.nextCursor;
    if (!nextCursor || !response.legacyResult.hasMore) return;
    
    // We generate a new Request ID for the new page
    const reqId = AttendanceShadowService.generateRequestId();
    
    // The new stack includes the cursor we are ABOUT to use
    const newStack = [...cursorStack, nextCursor];
    
    await executeCore(currentParams, nextCursor, reqId, newStack);
  }, [response, currentParams, activeRequestId, cursorStack]);

  const previousPage = useCallback(async () => {
    if (!response || !currentParams || !activeRequestId || cursorStack.length <= 1) return;
    
    // We go back one page. 
    // If stack is [null, cursor1, cursor2], we are currently viewing page 3 (fetched with cursor2).
    // To view page 2, we need to fetch using cursor1.
    // The new stack should be [null, cursor1]
    const newStack = cursorStack.slice(0, cursorStack.length - 1);
    const cursorToUse = newStack[newStack.length - 1]; // cursor1
    
    const reqId = AttendanceShadowService.generateRequestId();
    
    await executeCore(currentParams, cursorToUse, reqId, newStack);
  }, [response, currentParams, activeRequestId, cursorStack]);

  const hasNextPage = response?.legacyResult.hasMore || false;
  const hasPreviousPage = cursorStack.length > 1;

  return {
    response,
    loading,
    error,
    execute,
    nextPage,
    previousPage,
    reset,
    hasNextPage,
    hasPreviousPage
  };
}
