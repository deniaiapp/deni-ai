export async function runWithLoading(
  setLoading: (loading: boolean) => void,
  work: () => Promise<void>,
) {
  setLoading(true);
  try {
    await work();
  } finally {
    setLoading(false);
  }
}
