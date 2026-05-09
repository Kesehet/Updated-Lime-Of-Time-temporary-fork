/**
 * Business Hours Settings Screen
 * 
 * Unified settings for business availability:
 * 1. Weekly Business Hours (Monday-Sunday)
 * 2. Daily Overrides (specific date exceptions)
 * 3. Multi-Staff Mode toggle
 * 
 * Features:
 * - Edit weekly schedule
 * - Add/remove daily overrides
 * - Toggle multi-staff mode
 * - Visual calendar view of overrides
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/screen-container';
import { SimpleTimePicker } from '@/components/ui/time-picker-wheel';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { useResponsive } from '@/hooks/use-responsive';
import { FuturisticBackground } from "@/components/futuristic-background";


const DAYS_OF_WEEK = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
];

interface DailyOverride {
  date: string;
  isWorkDay: boolean;
  startTime?: string;
  endTime?: string;
  notes?: string;
}

interface WeeklyHours {
  [day: string]: {
    isEnabled: boolean;
    startTime: string;
    endTime: string;
  };
}

export default function BusinessHoursSettings() {
  const router = useRouter();
  const { state } = useStore();
  const { isTablet, hp, fs, buttonHeight, iconButtonSize } = useResponsive();

  const [weeklyHours, setWeeklyHours] = useState<WeeklyHours>({
    Monday: { isEnabled: true, startTime: '09:00', endTime: '17:00' },
    Tuesday: { isEnabled: true, startTime: '09:00', endTime: '17:00' },
    Wednesday: { isEnabled: true, startTime: '09:00', endTime: '17:00' },
    Thursday: { isEnabled: true, startTime: '09:00', endTime: '17:00' },
    Friday: { isEnabled: true, startTime: '09:00', endTime: '17:00' },
    Saturday: { isEnabled: false, startTime: '10:00', endTime: '14:00' },
    Sunday: { isEnabled: false, startTime: '10:00', endTime: '14:00' }
  });

  const [dailyOverrides, setDailyOverrides] = useState<DailyOverride[]>([]);
  const [multiStaffMode, setMultiStaffMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'weekly' | 'overrides' | 'settings'>('weekly');
  const [editingDay, setEditingDay] = useState<string | null>(null);

  // Load existing settings from store
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      // TODO: Load from API/store
      // For now, using default values
    } catch (error) {
      console.error('Error loading settings:', error);
      Alert.alert('Error', 'Failed to load business hours settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveWeeklyHours = async () => {
    try {
      setLoading(true);
      // TODO: Save to API
      Alert.alert('Success', 'Business hours updated');
    } catch (error) {
      console.error('Error saving hours:', error);
      Alert.alert('Error', 'Failed to save business hours');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleDay = (day: string) => {
    setWeeklyHours(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        isEnabled: !prev[day].isEnabled
      }
    }));
  };

  const handleUpdateTime = (day: string, field: 'startTime' | 'endTime', time: string) => {
    setWeeklyHours(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [field]: time
      }
    }));
  };

  const handleAddOverride = () => {
    // TODO: Show date picker and create override
    Alert.alert('Add Daily Override', 'Select a date to override business hours');
  };

  const handleRemoveOverride = (date: string) => {
    setDailyOverrides(prev => prev.filter(o => o.date !== date));
  };

  const handleToggleMultiStaffMode = () => {
    setMultiStaffMode(!multiStaffMode);
  };

  if (loading) {
    return (
      <ScreenContainer className="items-center justify-center">
      <FuturisticBackground />
        <ActivityIndicator size="large" />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer className="p-0" tabletMaxWidth={720}>
      {/* Header */}
      <View className="bg-primary py-4" style={{ paddingHorizontal: hp }}>
        <Pressable onPress={() => router.back()}>
          <Text className="text-background text-lg font-semibold">← Back</Text>
        </Pressable>
        <Text className="text-background text-2xl font-bold mt-2">Business Hours</Text>
      </View>

      {/* Tab Navigation */}
      <View className="flex-row border-b border-border">
        {(['weekly', 'overrides', 'settings'] as const).map(tab => (
          <Pressable
            key={tab}
            onPress={() => setActiveTab(tab)}
            className={cn(
              'flex-1 py-3 px-4 border-b-2',
              activeTab === tab ? 'border-primary' : 'border-transparent'
            )}
          >
            <Text
              className={cn(
                'text-center font-semibold',
                activeTab === tab ? 'text-primary' : 'text-muted'
              )}
            >
              {tab === 'weekly' && 'Weekly'}
              {tab === 'overrides' && 'Overrides'}
              {tab === 'settings' && 'Settings'}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ flexGrow: 1, paddingBottom: 40 }}>
        {/* Weekly Hours Tab */}
        {activeTab === 'weekly' && (
          <View style={{ padding: hp, gap: 16 }}>
            <Text className="text-lg font-semibold text-foreground">Weekly Schedule</Text>

            {DAYS_OF_WEEK.map(day => (
              <View key={day} className="bg-surface rounded-lg p-4 gap-3">
                {/* Day Header with Toggle */}
                <View className="flex-row items-center justify-between">
                  <Text className="font-semibold text-foreground">{day}</Text>
                  <Pressable
                    onPress={() => handleToggleDay(day)}
                    className={cn(
                      'px-4 py-2 rounded-full',
                      weeklyHours[day].isEnabled ? 'bg-success' : 'bg-muted'
                    )}
                  >
                    <Text
                      className={cn(
                        'font-semibold',
                        weeklyHours[day].isEnabled ? 'text-background' : 'text-muted'
                      )}
                    >
                      {weeklyHours[day].isEnabled ? 'Open' : 'Closed'}
                    </Text>
                  </Pressable>
                </View>

                {/* Time Pickers */}
                {weeklyHours[day].isEnabled && (
                  <View className="gap-3">
                    <View className="gap-2">
                      <Text className="text-sm text-muted">Start Time</Text>
                      <SimpleTimePicker
                        value={weeklyHours[day].startTime}
                        onChange={(time) => handleUpdateTime(day, 'startTime', time)}
                        testID={`start-time-${day}`}
                      />
                    </View>

                    <View className="gap-2">
                      <Text className="text-sm text-muted">End Time</Text>
                      <SimpleTimePicker
                        value={weeklyHours[day].endTime}
                        onChange={(time) => handleUpdateTime(day, 'endTime', time)}
                        testID={`end-time-${day}`}
                      />
                    </View>
                  </View>
                )}
              </View>
            ))}

            {/* Save Button */}
            <Pressable
              onPress={handleSaveWeeklyHours}
              className="bg-primary rounded-lg py-3 mt-4"
            >
              <Text className="text-background text-center font-semibold text-lg">
                Save Weekly Schedule
              </Text>
            </Pressable>
          </View>
        )}

        {/* Daily Overrides Tab */}
        {activeTab === 'overrides' && (
          <View style={{ padding: hp, gap: 16 }}>
            <View className="flex-row items-center justify-between">
              <Text className="text-lg font-semibold text-foreground">Daily Overrides</Text>
              <Pressable
                onPress={handleAddOverride}
                className="bg-primary rounded-lg px-4 py-2"
              >
                <Text className="text-background font-semibold">+ Add</Text>
              </Pressable>
            </View>

            {dailyOverrides.length === 0 ? (
              <View className="items-center justify-center py-8">
                <Text className="text-muted text-center">
                  No daily overrides yet.{'\n'}Add one to change hours for specific dates.
                </Text>
              </View>
            ) : (
              <FlatList
                data={dailyOverrides}
                keyExtractor={(item) => item.date}
                scrollEnabled={false}
                renderItem={({ item }) => (
                  <View className="bg-surface rounded-lg p-4 mb-3 flex-row items-center justify-between">
                    <View className="flex-1">
                      <Text className="font-semibold text-foreground">{item.date}</Text>
                      <Text className="text-sm text-muted mt-1">
                        {item.isWorkDay
                          ? `${item.startTime} - ${item.endTime}`
                          : 'Closed'}
                      </Text>
                      {item.notes && (
                        <Text className="text-xs text-muted mt-1">{item.notes}</Text>
                      )}
                    </View>
                    <Pressable
                      onPress={() => handleRemoveOverride(item.date)}
                      className="p-2"
                    >
                      <Text className="text-error font-bold">✕</Text>
                    </Pressable>
                  </View>
                )}
              />
            )}
          </View>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <View style={{ padding: hp, gap: 16 }}>
            <Text className="text-lg font-semibold text-foreground">Settings</Text>

            {/* Multi-Staff Mode Toggle */}
            <View className="bg-surface rounded-lg p-4 flex-row items-center justify-between">
              <View className="flex-1">
                <Text className="font-semibold text-foreground">Multi-Staff Mode</Text>
                <Text className="text-sm text-muted mt-1">
                  {multiStaffMode
                    ? 'Enabled - Manage individual staff schedules'
                    : 'Disabled - Solo business owner'}
                </Text>
              </View>
              <Pressable
                onPress={handleToggleMultiStaffMode}
                className={cn(
                  'px-4 py-2 rounded-full',
                  multiStaffMode ? 'bg-success' : 'bg-muted'
                )}
              >
                <Text
                  className={cn(
                    'font-semibold',
                    multiStaffMode ? 'text-background' : 'text-muted'
                  )}
                >
                  {multiStaffMode ? 'On' : 'Off'}
                </Text>
              </Pressable>
            </View>

            {/* Info Box */}
            <View className="bg-blue-50 rounded-lg p-4 border border-blue-200">
              <Text className="text-sm text-blue-900 leading-relaxed">
                <Text className="font-semibold">Multi-Staff Mode</Text> allows you to set
                individual availability for each staff member. Disable this if you're a solo
                business owner.
              </Text>
            </View>

            {/* Save Button */}
            <Pressable
              onPress={() => {
                Alert.alert('Success', 'Settings saved');
              }}
              className="bg-primary rounded-lg py-3 mt-4"
            >
              <Text className="text-background text-center font-semibold text-lg">
                Save Settings
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
