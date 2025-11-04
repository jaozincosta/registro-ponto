import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    const checkUser = async () => {
      const userData = await AsyncStorage.getItem("user");
      if (userData) {
        router.replace("/dashboard");
      } else {
        router.replace("/register");
      }
    };
    checkUser();
  }, []);

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#F8FAFF",
      }}
    >
      <ActivityIndicator size="large" color="#0066FF" />
    </View>
  );
}
