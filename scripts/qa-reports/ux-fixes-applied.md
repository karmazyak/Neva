# UX/UI Fixes Applied

**Date:** 2026-03-29
**Tester:** Claude Code QA

---

## Fix 1: GuidedTour tooltip overlapping page headers

**Screen:** All pages (Chats, Profile, Relationships, Robot Store, Saved Messages)
**Issue:** Tour progress tooltip (`TourProgress` component) was positioned `fixed top-3 left-1/2 -translate-x-1/2 z-[100]`, covering page titles and action buttons on every screen. On mobile (375px), it completely hid folder tabs and "Find Person" button.
**Fix:** Changed positioning from center to right-aligned (`right-3`), reduced z-index from 100 to 60, reduced padding, limited max-width to 260px.
**File:** `client/src/components/GuidedTour.tsx` line 227
**Before:** `fixed top-3 left-1/2 -translate-x-1/2 z-[100]`
**After:** `fixed top-3 right-3 z-[60] max-w-[260px]`

---

## Fix 2: Mixed English/Russian UI on Profile page

**Screen:** Profile (`/profile`)
**Issue:** Page had mixed languages — "Display Name", "Username", "Status", "Appearance", "Privacy & Security", "Log Out", "Credits", "My Agents", "Chats" in English alongside Russian "Уведомления", "Звук уведомлений".
**Fix:** Translated all English strings to Russian.
**File:** `client/src/pages/Profile.tsx`
**Changes:**
- "Profile" → "Профиль"
- "Display Name" → "Имя"
- "Username" → "Логин"
- "Email" / "Not set" → "Email" / "Не указан"
- "Status" → "Статус"
- "Set a status..." → "Установить статус..."
- "Appearance" → "Оформление"
- "Dark theme" / "Light theme" → "Тёмная тема" / "Светлая тема"
- "Dark" / "Light" → "Тёмная" / "Светлая"
- "Easy on the eyes" / "Classic bright look" → "Бережёт глаза" / "Классический вид"
- "Privacy & Security" → "Конфиденциальность"
- "End-to-end encryption" → "Сквозное шифрование"
- "Credits" → "Кредиты"
- "My Agents" → "Мои агенты"
- "Chats" → "Чаты"
- "Log Out" → "Выйти"

---

## Fix 3: English labels in TabBar navigation

**Screen:** All pages (bottom navigation)
**Issue:** "Chats" and "Profile" tabs in English, "Люди" and "AI" already in Russian.
**Fix:** Translated to Russian.
**File:** `client/src/components/TabBar.tsx`
**Changes:**
- "Chats" → "Чаты"
- "Profile" → "Профиль"

---

## Fix 4: English header in Chat List

**Screen:** Chats (`/`)
**Issue:** Mobile header said "Chats" in English.
**Fix:** Changed to "Чаты".
**File:** `client/src/components/chat/ChatList.tsx` line 138

---

## Fix 5: English labels in Saved Messages

**Screen:** Saved Messages (`/saved`)
**Issue:** "Saved Messages", "No saved messages yet", "Long-press any message..." all in English.
**Fix:** Translated to Russian.
**File:** `client/src/pages/SavedMessages.tsx`
**Changes:**
- "Saved Messages" → "Сохранённые"
- "No saved messages yet" → "Пока ничего не сохранено"
- "Long-press..." → "Нажмите и удерживайте сообщение, чтобы сохранить его."

---

## Fix 6: English labels in My Robots

**Screen:** My Robots (`/robots`)
**Issue:** "My Robots", "Create New Robot", "Select a robot to configure", "Publish to Robot Store" in English.
**Fix:** Translated to Russian.
**File:** `client/src/pages/MyRobots.tsx`
**Changes:**
- "My Robots" → "Мои роботы" (2 places)
- "Create New Robot" → "Создать робота"
- "Select a robot to configure" → "Выберите робота для настройки"
- "Publish to Robot Store" → "Опубликовать в магазине"
- "Make this robot available to everyone" → "Сделать робота доступным для всех"

---

## Fix 7: English labels in Robot Store

**Screen:** Robot Store (`/store`)
**Issue:** "Robot Store", "Search robots...", "Popular", "Top Rated", "Newest", "Featured", "Installed", "Install Free", "Robot Installed!" in English.
**Fix:** Translated to Russian.
**File:** `client/src/pages/RobotStore.tsx`
**Changes:**
- "Robot Store" → "Магазин роботов"
- "Search robots..." → "Поиск роботов..."
- "Popular" → "Популярные"
- "Top Rated" → "Лучшие"
- "Newest" → "Новые"
- "Featured" → "Топ"
- "Installed" → "Установлен"
- "Installing..." → "Установка..."
- "Install Free" → "Установить"
- "Robot Installed!" → "Робот установлен!"

---

## Summary

| # | Fix | Severity | Files Changed |
|---|-----|----------|---------------|
| 1 | GuidedTour tooltip overlap | Major | GuidedTour.tsx |
| 2 | Profile mixed languages | Major | Profile.tsx |
| 3 | TabBar English labels | Minor | TabBar.tsx |
| 4 | ChatList English header | Minor | ChatList.tsx |
| 5 | SavedMessages English | Minor | SavedMessages.tsx |
| 6 | MyRobots English | Minor | MyRobots.tsx |
| 7 | RobotStore English | Minor | RobotStore.tsx |

**Total files changed:** 7
**Total string translations:** ~35+
