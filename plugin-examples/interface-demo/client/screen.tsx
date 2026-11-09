import type { PluginScreenProps } from "@getpaseo/plugin/client";
import {
  ScrollView,
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

export function DemoScreen({ theme, host, layout }: PluginScreenProps) {
  const [count, setCount] = useState(0);
  const layoutLabel = layout.compact ? "紧凑布局" : "宽屏布局";
  const increment = useCallback(() => setCount((value) => value + 1), []);
  const reset = useCallback(() => setCount(0), []);
  const styles = useMemo(
    () =>
      StyleSheet.create({
        screen: { flex: 1, backgroundColor: theme.colors.surface0 },
        content: { padding: layout.compact ? 16 : 32, alignItems: "center" },
        body: { width: "100%", maxWidth: 720, gap: 28 },
        text: { color: theme.colors.foreground, fontSize: 14 },
        muted: { color: theme.colors.foregroundMuted, fontSize: 14 },
        count: {
          color: theme.colors.foreground,
          fontSize: 24,
          fontVariant: ["tabular-nums"],
        },
      }),
    [theme, layout.compact],
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.body}>
        <Text style={styles.muted}>
          这是一个通过插件加进 Paseo 的页面。左侧入口、页面内容和下面的交互都由插件提供。
        </Text>

        <SettingsSection title="交互演示">
          <SettingsCard>
            <SettingsRow label="当前计数" hint="试试下面的按钮，页面会立即更新。">
              <Text
                testID="demo-count"
                accessibilityLabel={`当前计数：${count}`}
                style={styles.count}
              >
                {count}
              </Text>
            </SettingsRow>
            <SettingsAction label="增加计数" actionLabel="加 1" onPress={increment} />
            <SettingsAction
              label="重新开始"
              actionLabel="归零"
              disabled={count === 0}
              onPress={reset}
            />
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title="运行环境">
          <SettingsCard>
            <SettingsRow label="当前主机">
              <Text style={styles.text}>{host.label}</Text>
            </SettingsRow>
            <SettingsRow label="布局">
              <Text style={styles.text}>{layoutLabel}</Text>
            </SettingsRow>
            <SettingsRow label="客户端平台">
              <Text style={styles.text}>{layout.platform}</Text>
            </SettingsRow>
            <SettingsRow label="插件类型">
              <Text style={styles.text}>仅客户端</Text>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>

        <Text style={styles.muted}>
          本页不访问文件或外部服务，也不创建 Agent。计数只保存在当前页面，离开后会重置。
        </Text>
      </View>
    </ScrollView>
  );
}
