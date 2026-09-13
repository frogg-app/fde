import AsyncStorage from "@react-native-async-storage/async-storage";
import { brand } from "@frogg/branding";
import { storageKey } from "@frogg/branding/identity";

function logicalKey(key: string): string | null {
  if (brand.storagePrefix)
    return key.startsWith(brand.storagePrefix) ? key.slice(brand.storagePrefix.length) : null;
  return /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,}:/.test(key) ? null : key;
}

const brandStorage: Pick<
  typeof AsyncStorage,
  "getItem" | "setItem" | "removeItem" | "getAllKeys" | "multiGet" | "multiRemove"
> = {
  async getAllKeys(callback) {
    const keys = (await AsyncStorage.getAllKeys()).map(logicalKey).filter((key) => key !== null);
    callback?.(null, keys);
    return keys;
  },
  async multiGet(keys, callback) {
    const rows = await AsyncStorage.multiGet(keys.map((key) => storageKey(brand, key)));
    const logicalRows: [string, string | null][] = rows.map(([key, value]) => [
      key.slice(brand.storagePrefix.length),
      value,
    ]);
    callback?.(null, logicalRows);
    return logicalRows;
  },
  multiRemove(keys, callback) {
    return AsyncStorage.multiRemove(
      keys.map((key) => storageKey(brand, key)),
      callback,
    );
  },
  getItem(key, callback) {
    return AsyncStorage.getItem(storageKey(brand, key), callback);
  },
  setItem(key, value, callback) {
    return AsyncStorage.setItem(storageKey(brand, key), value, callback);
  },
  removeItem(key, callback) {
    return AsyncStorage.removeItem(storageKey(brand, key), callback);
  },
};
export default brandStorage;
