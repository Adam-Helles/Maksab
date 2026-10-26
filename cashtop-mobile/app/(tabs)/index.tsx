import { Redirect } from 'expo-router';

// This file must exist so Expo Router recognizes '/(tabs)' as a valid group.
// It immediately redirects to the customers tab so the user never sees a blank page.
export default function TabsIndex() {
  return <Redirect href={'/(tabs)/customers' as any} />;
}
