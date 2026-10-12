import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { api } from './api';

// Load data from the API every time the screen comes into focus.
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const current = useRef(path);
  current.current = path;

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const res = await api<T>(path);
      if (current.current === path) {
        setData(res);
        setError('');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [path]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { data, error, reload: load, refresh, refreshing };
}
