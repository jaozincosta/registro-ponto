import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

/**
 * Liste aqui os feriados (formato YYYY-MM-DD). Pode expandir depois.
 * Incluí os fixos nacionais do Brasil (2025).
 */
const HOLIDAYS_2025 = new Set<string>([
  "2025-01-01", // Confraternização Universal
  "2025-04-21", // Tiradentes
  "2025-05-01", // Dia do Trabalho
  "2025-09-07", // Independência
  "2025-10-12", // Nossa Sra. Aparecida
  "2025-11-02", // Finados
  "2025-11-15", // Proclamação da República
  "2025-12-25", // Natal
]);

const RECORD_SEQUENCE = [
  "Entrada",
  "Início Almoço",
  "Término Almoço",
  "Saída",
] as const;
type RecordType = (typeof RECORD_SEQUENCE)[number];
type WorkLocal = "Presencial" | "Em campo";

type Punch = {
  id: number;
  tipo: RecordType;
  local: WorkLocal;
  hora: string;
  data: string;
  dateYMD: string;
};

type DailySummary = {
  dateYMD: string;
  workedMinutes: number;
  bankDeltaMinutes: number;
  isHoliday: boolean;
  isBridge: boolean;
};

export default function DashboardScreen() {
  const router = useRouter();

  const [user, setUser] = useState<any>(null);
  const [records, setRecords] = useState<Punch[]>([]);
  const [lastRecord, setLastRecord] = useState<Punch | null>(null);
  const [currentDay, setCurrentDay] = useState<number>(0);

  const [modalVisible, setModalVisible] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [selectedType, setSelectedType] = useState<RecordType | "">("");
  const [selectedLocal, setSelectedLocal] = useState<WorkLocal>("Presencial");
  const [selectedTime, setSelectedTime] = useState<Date>(new Date());

  const [timeBankMinutes, setTimeBankMinutes] = useState<number>(0);
  const [todaySummary, setTodaySummary] = useState<DailySummary | null>(null);

  useEffect(() => {
    const today = new Date().getDay();
    setCurrentDay(today === 0 ? 6 : today - 1);
    loadAll();
  }, []);

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const toYMD = (d: Date): string =>
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const toDMYpt = (d: Date): string =>
    `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;

  const makeDateFromYMD_HM = (ymd: string, hm: string): Date => {
    const [year, month, day] = ymd.split("-").map(Number);
    const [hh, mm] = hm.split(":").map(Number);
    return new Date(
      year,
      (month as number) - 1,
      day as number,
      hh as number,
      mm as number,
      0,
      0
    );
  };

  const formatMinutesSigned = (mins: number): string => {
    const sign = mins === 0 ? "" : mins > 0 ? "+" : "-";
    const abs = Math.abs(mins);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return `${sign}${pad2(h)}:${pad2(m)}`;
  };

  const isHoliday = (ymd: string): boolean => HOLIDAYS_2025.has(ymd);

  const isBridgeDay = (ymd: string): boolean => {
    const d = new Date(ymd);
    const dow = d.getDay();
    const prev = new Date(d);
    prev.setDate(d.getDate() - 1);
    const next = new Date(d);
    next.setDate(d.getDate() + 1);
    const prevYMD = toYMD(prev);
    const nextYMD = toYMD(next);

    if (dow === 5 && isHoliday(prevYMD)) return true;
    if (dow === 1 && isHoliday(nextYMD)) return true;

    return false;
  };

  const loadAll = async () => {
    const userData = await AsyncStorage.getItem("user");
    if (!userData) return;

    const u = JSON.parse(userData);
    setUser(u);

    const usersData = await AsyncStorage.getItem("usersRecords");
    const all = usersData ? JSON.parse(usersData) : {};
    const list: Punch[] = all[u.email] ?? [];
    setRecords(list);
    setLastRecord(list.length ? list[list.length - 1] : null);

    const bankRaw = await AsyncStorage.getItem("usersTimeBank");
    const bankAll = bankRaw ? JSON.parse(bankRaw) : {};
    setTimeBankMinutes(bankAll[u.email] ?? 0);

    await recomputeTodaySummary(u.email, list, bankAll[u.email] ?? 0);
  };

  const saveAllForUser = async (
    email: string,
    newRecords: Punch[],
    bankMinutes?: number
  ) => {
    const usersData = await AsyncStorage.getItem("usersRecords");
    const all = usersData ? JSON.parse(usersData) : {};
    all[email] = newRecords;
    await AsyncStorage.setItem("usersRecords", JSON.stringify(all));

    if (typeof bankMinutes === "number") {
      const bankRaw = await AsyncStorage.getItem("usersTimeBank");
      const bankAll = bankRaw ? JSON.parse(bankRaw) : {};
      bankAll[email] = bankMinutes;
      await AsyncStorage.setItem("usersTimeBank", JSON.stringify(bankAll));
      setTimeBankMinutes(bankMinutes);
    }

    setRecords(newRecords);
    setLastRecord(newRecords.length ? newRecords[newRecords.length - 1] : null);
  };

  const computeWorkedMinutesOfDay = (dayRecords: Punch[]): number => {
    const map = new Map<RecordType, Punch>();
    for (const r of dayRecords) map.set(r.tipo, r);

    const entrada = map.get("Entrada");
    const inicio = map.get("Início Almoço");
    const termino = map.get("Término Almoço");
    const saida = map.get("Saída");

    let total = 0;
    if (entrada && inicio) {
      total += Math.max(
        0,
        ((makeDateFromYMD_HM(entrada.dateYMD, entrada.hora).getTime() -
          makeDateFromYMD_HM(entrada.dateYMD, inicio.hora).getTime()) *
          -1) /
          60000
      );
    }
    if (termino && saida) {
      total += Math.max(
        0,
        ((makeDateFromYMD_HM(termino.dateYMD, termino.hora).getTime() -
          makeDateFromYMD_HM(termino.dateYMD, saida.hora).getTime()) *
          -1) /
          60000
      );
    }
    return Math.round(total);
  };

  const recomputeTodaySummary = async (
    email: string,
    allRecords: Punch[],
    currentBank: number
  ) => {
    const ymd = toYMD(new Date());
    const dayRecords = allRecords.filter((r) => r.dateYMD === ymd);

    const holiday = isHoliday(ymd);
    const bridge = isBridgeDay(ymd);
    const worked = computeWorkedMinutesOfDay(dayRecords);

    let bankDelta = 0;
    if (holiday || bridge) {
      bankDelta = worked;
    } else {
      bankDelta = worked - 8 * 60;
    }

    const summary: DailySummary = {
      dateYMD: ymd,
      workedMinutes: worked,
      bankDeltaMinutes: bankDelta,
      isHoliday: holiday,
      isBridge: bridge,
    };
    setTodaySummary(summary);

    const dayCount = dayRecords.length;
    if (dayCount === 4) {
      const newBank = currentBank + bankDelta;
      await saveAllForUser(email, allRecords, newBank);
    }
  };

  const handleLogout = async () => {
    Alert.alert("Sair", "Deseja realmente sair?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Sair",
        style: "destructive",
        onPress: async () => {
          await AsyncStorage.removeItem("user");
          router.replace("/register");
        },
      },
    ]);
  };

  const handleAddRecord = async (
    localEscolhido: WorkLocal,
    customTime?: string
  ) => {
    if (!user) return;
    const email = user.email;

    const now = new Date();
    const ymd = toYMD(now);
    const dmy = toDMYpt(now);

    const list = [...records];
    const todayRecords = list.filter((r) => r.dateYMD === ymd);

    if (todayRecords.length >= 4) {
      Alert.alert("Aviso", "Você já registrou as 4 batidas de hoje.");
      return;
    }

    const nextType = RECORD_SEQUENCE[todayRecords.length];

    const hora =
      customTime ||
      now.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      });

    const newPunch: Punch = {
      id: Date.now(),
      tipo: nextType,
      local: localEscolhido,
      hora,
      data: dmy,
      dateYMD: ymd,
    };

    list.push(newPunch);
    await saveAllForUser(email, list);

    const bankRaw = await AsyncStorage.getItem("usersTimeBank");
    const bankAll = bankRaw ? JSON.parse(bankRaw) : {};
    await recomputeTodaySummary(email, list, bankAll[email] ?? 0);
  };

  const handleAdjustRecord = async () => {
    if (!user) return;
    const email = user.email;

    if (!selectedType) {
      Alert.alert("Selecione o registro que deseja ajustar.");
      return;
    }

    const now = new Date();
    const ymd = toYMD(now);
    const dmy = toDMYpt(now);

    const list = [...records];
    const idx = list.findIndex(
      (r) => r.dateYMD === ymd && r.tipo === selectedType
    );

    const horaFormatada = selectedTime.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });

    if (idx !== -1) {
      list[idx].hora = horaFormatada;
      list[idx].local = selectedLocal;
    } else {
      list.push({
        id: Date.now(),
        tipo: selectedType as RecordType,
        local: selectedLocal,
        hora: horaFormatada,
        data: dmy,
        dateYMD: ymd,
      });
    }

    await saveAllForUser(email, list);
    setModalVisible(false);

    const bankRaw = await AsyncStorage.getItem("usersTimeBank");
    const bankAll = bankRaw ? JSON.parse(bankRaw) : {};
    await recomputeTodaySummary(email, list, bankAll[email] ?? 0);

    Alert.alert("Sucesso", "Registro ajustado com sucesso!");
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.helloText}>Olá {user?.nome || "Usuário"}!</Text>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
          <Ionicons name="log-out-outline" size={22} color="#0066FF" />
        </TouchableOpacity>
      </View>

      <View style={styles.weekRow}>
        {["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"].map((dia, i) => (
          <View
            key={i}
            style={[
              styles.dayItem,
              i === currentDay && { backgroundColor: "#0066FF" },
            ]}
          >
            <Text
              style={[styles.dayText, i === currentDay && { color: "#fff" }]}
            >
              {dia}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.clockCircle}>
        <Text style={styles.clockTime}>{lastRecord?.hora || "--:--"}</Text>
        <Text style={styles.clockLabel}>
          ({lastRecord?.tipo || "Sem registro"})
        </Text>
        <Text style={styles.lastRecord}>Último registro</Text>
      </View>

      <View style={styles.bankCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.bankTitle}>Banco de horas</Text>
          <Text style={styles.bankValue}>
            {formatMinutesSigned(timeBankMinutes)}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.bankTitle}>Hoje</Text>
          <Text style={styles.bankMeta}>
            {(todaySummary?.isHoliday && "Feriado") ||
              (todaySummary?.isBridge && "Emenda") ||
              "Dia útil"}
          </Text>
          <Text style={styles.bankToday}>
            {(todaySummary &&
              formatMinutesSigned(todaySummary.bankDeltaMinutes)) ||
              "+00:00"}
          </Text>
        </View>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.outlinedButton}
          onPress={() => setModalVisible(true)}
        >
          <Text style={styles.outlinedButtonText}>Ajustar ponto</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() =>
            Alert.alert("Onde você está?", "", [
              {
                text: "Presencial",
                onPress: () => handleAddRecord("Presencial"),
              },
              { text: "Em Campo", onPress: () => handleAddRecord("Em campo") },
            ])
          }
        >
          <Text style={styles.primaryButtonText}>Bater ponto</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.recordsContainer}>
        <Text style={styles.recordsTitle}>Últimos registros</Text>
        {records.length === 0 ? (
          <Text style={{ color: "#666", textAlign: "center" }}>
            Nenhum registro ainda
          </Text>
        ) : (
          [...records]
            .slice(-8)
            .reverse()
            .map((r) => (
              <View key={r.id} style={styles.card}>
                <Ionicons
                  name={
                    r.tipo === "Entrada"
                      ? "log-in-outline"
                      : r.tipo === "Saída"
                      ? "log-out-outline"
                      : "time-outline"
                  }
                  size={22}
                  color="#0066FF"
                />
                <View style={styles.cardInfo}>
                  <Text style={styles.cardTitle}>{r.tipo}</Text>
                  <Text style={styles.cardSubtitle}>
                    {r.data} • {r.dateYMD}
                  </Text>
                </View>
                <View style={styles.cardRight}>
                  <Text style={styles.cardTag}>{r.local}</Text>
                  <Text style={styles.cardTime}>{r.hora}</Text>
                </View>
              </View>
            ))
        )}
      </View>

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Ajustar Ponto</Text>

            <Text style={styles.modalSubtitle}>
              Qual registro deseja alterar?
            </Text>

            {RECORD_SEQUENCE.map((tipo) => (
              <TouchableOpacity
                key={tipo}
                style={[
                  styles.optionButton,
                  selectedType === tipo && styles.optionSelected,
                ]}
                onPress={() => setSelectedType(tipo)}
              >
                <Text
                  style={[
                    styles.optionText,
                    selectedType === tipo && { color: "#fff" },
                  ]}
                >
                  {tipo}
                </Text>
              </TouchableOpacity>
            ))}

            <View style={styles.modalRow}>
              <TouchableOpacity
                style={[
                  styles.optionButtonSmall,
                  selectedLocal === "Presencial" && styles.optionSelected,
                ]}
                onPress={() => setSelectedLocal("Presencial")}
              >
                <Text
                  style={[
                    styles.optionText,
                    selectedLocal === "Presencial" && { color: "#fff" },
                  ]}
                >
                  Presencial
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.optionButtonSmall,
                  selectedLocal === "Em campo" && styles.optionSelected,
                ]}
                onPress={() => setSelectedLocal("Em campo")}
              >
                <Text
                  style={[
                    styles.optionText,
                    selectedLocal === "Em campo" && { color: "#fff" },
                  ]}
                >
                  Em Campo
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.timePickerButton}
              onPress={() => setPickerVisible(true)}
            >
              <Text style={styles.timePickerText}>
                Horário:{" "}
                {selectedTime.toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
            </TouchableOpacity>

            {pickerVisible && (
              <DateTimePicker
                value={selectedTime}
                mode="time"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onChange={(event, date) => {
                  setPickerVisible(false);
                  if (date) setSelectedTime(date);
                }}
              />
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setModalVisible(false)}
              >
                <Text style={{ color: "#333" }}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.saveButton}
                onPress={handleAdjustRecord}
              >
                <Text style={{ color: "#fff", fontWeight: "bold" }}>
                  Salvar
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFF",
    paddingHorizontal: 20,
    paddingTop: 60,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 25,
  },
  helloText: { fontSize: 22, fontWeight: "700" },
  logoutButton: {
    width: 35,
    height: 35,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: "#0066FF",
    justifyContent: "center",
    alignItems: "center",
  },
  weekRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  dayItem: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  dayText: { fontWeight: "600", fontSize: 12, color: "#333" },
  clockCircle: {
    backgroundColor: "#0066FF",
    width: 220,
    height: 220,
    borderRadius: 110,
    alignSelf: "center",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  clockTime: { color: "#fff", fontSize: 42, fontWeight: "bold" },
  clockLabel: { color: "#fff", fontSize: 16 },
  lastRecord: { color: "#fff", opacity: 0.85, fontSize: 14, marginTop: 8 },

  bankCard: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    elevation: 1,
    gap: 12,
  },
  bankTitle: { fontSize: 12, color: "#666" },
  bankValue: { fontSize: 20, fontWeight: "800", color: "#0a0" },
  bankToday: { fontSize: 16, fontWeight: "700" },
  bankMeta: { fontSize: 12, color: "#333", marginBottom: 4 },

  buttonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 32,
  },
  outlinedButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#0066FF",
    borderRadius: 10,
    padding: 12,
    marginRight: 6,
    alignItems: "center",
  },
  outlinedButtonText: { color: "#0066FF", fontWeight: "600" },
  primaryButton: {
    flex: 1,
    backgroundColor: "#0066FF",
    borderRadius: 10,
    padding: 12,
    marginLeft: 6,
    alignItems: "center",
  },
  primaryButtonText: { color: "#fff", fontWeight: "600" },

  recordsContainer: { marginBottom: 80 },
  recordsTitle: { fontWeight: "700", fontSize: 16, marginBottom: 10 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 15,
    flexDirection: "row",
    alignItems: "center",
    elevation: 1,
    marginBottom: 10,
  },
  cardInfo: { flex: 1, marginLeft: 10 },
  cardTitle: { fontWeight: "700", fontSize: 15 },
  cardSubtitle: { color: "#666", fontSize: 13 },
  cardRight: { alignItems: "flex-end" },
  cardTag: { color: "#0066FF", fontSize: 12 },
  cardTime: { fontWeight: "700", fontSize: 15 },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "85%",
    backgroundColor: "#fff",
    borderRadius: 15,
    padding: 20,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", textAlign: "center" },
  modalSubtitle: {
    fontSize: 14,
    color: "#333",
    marginVertical: 10,
    textAlign: "center",
  },
  optionButton: {
    borderWidth: 1,
    borderColor: "#0066FF",
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
    marginBottom: 6,
  },
  optionButtonSmall: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#0066FF",
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
    marginHorizontal: 5,
  },
  optionSelected: { backgroundColor: "#0066FF" },
  optionText: { fontWeight: "600", color: "#0066FF" },
  timePickerButton: {
    alignItems: "center",
    padding: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    marginVertical: 15,
  },
  timePickerText: { fontSize: 15, color: "#333" },
  modalActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
  },
  modalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 10,
  },
  cancelButton: {
    flex: 1,
    alignItems: "center",
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#eee",
    marginRight: 6,
  },
  saveButton: {
    flex: 1,
    alignItems: "center",
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#0066FF",
    marginLeft: 6,
  },
});
