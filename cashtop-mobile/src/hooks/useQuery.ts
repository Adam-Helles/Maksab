import { useState, useEffect, useCallback } from 'react';

interface UseQueryResult<T> {
  data:       T | null;
  loading:    boolean;
  error:      string | null;
  refetch:    () => void;
}

/**
 * Hook بسيط لجلب البيانات مع إدارة حالة التحميل والخطأ
 * 
 * مثال الاستخدام:
 * const { data, loading, refetch } = useQuery(() => productsApi.list());
 */
export function useQuery<T>(
  fetcher: () => Promise<T>,
  deps: any[] = [],
): UseQueryResult<T> {
  const [data,    setData]    = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'حدث خطأ');
    } finally {
      setLoading(false);
    }
  }, deps);

  useEffect(() => { fetch(); }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

/**
 * Hook للعمليات التي تغيّر البيانات (create, update, delete)
 */
export function useMutation<TArgs, TResult>(
  mutator: (args: TArgs) => Promise<TResult>,
) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const execute = async (args: TArgs): Promise<TResult | null> => {
    setLoading(true);
    setError(null);
    try {
      const result = await mutator(args);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'حدث خطأ';
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { execute, loading, error, clearError: () => setError(null) };
}
