import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@/src/components/empty-state";
import { DayTypeChip } from "@/src/components/nutrition/day-type-chip";
import { MealCard, NotTodayRow } from "@/src/components/nutrition/meal-card";
import { RegistrationSheet, type SheetTarget } from "@/src/components/nutrition/registration-sheet";
import { ShoppingListCard } from "@/src/components/nutrition/shopping-list-card";
import { SupplementStackView } from "@/src/components/nutrition/supplement-stack-view";
import { TodayCard } from "@/src/components/nutrition/today-card";
import { CapsLabel, Card, ErrorState, LoadingBlock, Screen, SegmentedControl } from "@/src/components/ui";
import { useMealRegistrations, type RegisterInput } from "@/src/hooks/use-meal-registrations";
import { useNutritionPlan } from "@/src/hooks/use-nutrition-plan";
import { useRefreshOnFocus } from "@/src/hooks/use-refresh-on-focus";
import { useSupplementLog } from "@/src/hooks/use-supplement-log";
import { useSupplementPlan } from "@/src/hooks/use-supplement-plan";
import { Swap, useArrival } from "@/src/lib/motion";
import { useIsOnline } from "@/src/lib/online";
import { useToday } from "@/src/lib/today";
import { Text, View } from "@/src/tw";
import type { MealItem, NutritionPlanMeal } from "@/src/types/database";
import { toDateKey } from "@/src/utils/dates";
import { itemsOf } from "@/src/utils/meal-counting";
import { doneCount, mealDisplayName, nextMealId, todayMeals } from "@/src/utils/meal-registration";
import { targetFor, type ResolvedDay } from "@/src/utils/nutrition-plan";

type Pane = "plan" | "supplements";
// Segment order: a pane further right drifts in from the right.
const PANES: Pane[] = ["plan", "supplements"];
/** A saved meal's pop key is dropped after its pop has played, so a card that
 *  remounts later can't replay it. */
const POP_CLEAR_MS = 1200;

/**
 * The Nutrición tab: PLAN (today's meals from the coach's plan, each
 * registered as eaten, as something else or as skipped) and SUPLEMENTOS (the
 * coach's stack, assigned separately: a client may have either, both or
 * neither).
 */
export default function NutritionScreen() {
  const { t } = useTranslation();
  const plan = useNutritionPlan();
  const supplements = useSupplementPlan();
  useRefreshOnFocus(plan.refresh);
  useRefreshOnFocus(supplements.refresh);

  // Seeded once both queries have loaded (spec «No plan»); after that the
  // client's choice wins, so a refetch can't move the pane under them.
  const [pane, setPane] = useState<Pane | null>(null);
  if (pane == null && !plan.loading && !supplements.loading) {
    setPane(plan.plan != null ? "plan" : supplements.plan != null ? "supplements" : "plan");
  }

  return (
    <View className="flex-1 bg-brand-dark">
      <View className="px-4 pt-3">
        <SegmentedControl
          segments={[
            { key: "plan", label: t("nutritionPlan.segmentPlan") },
            { key: "supplements", label: t("nutritionPlan.segmentSupplements") },
          ]}
          value={pane ?? "plan"}
          onChange={(k) => setPane(k as Pane)}
        />
      </View>

      {pane == null ? (
        <LoadingBlock />
      ) : (
        <Swap id={pane} order={PANES.indexOf(pane)} className="flex-1">
          {pane === "plan" ? (
            // A new day starts over: no open card or sheet carries past midnight.
            <PlanPane key={plan.todayKey} plan={plan} />
          ) : (
            <SupplementsPane
              supplements={supplements}
              day={plan.day}
              cycling={plan.plan?.day_cycling ?? false}
            />
          )}
        </Swap>
      )}
    </View>
  );
}

function PlanPane({ plan }: { plan: ReturnType<typeof useNutritionPlan> }) {
  const { t } = useTranslation();
  const online = useIsOnline();
  const reg = useMealRegistrations();
  /** The card open in place of the next meal; null opens the next one. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [popKeys, setPopKeys] = useState<Record<string, number>>({});
  const popSeq = useRef(0);
  const arrive = useArrival(plan.loading && plan.plan == null);

  if (plan.loading && plan.plan == null) return <LoadingBlock />;
  if (plan.error && plan.plan == null) return <ErrorState onRetry={plan.refresh} />;
  if (plan.plan == null) {
    return (
      <Screen entering={arrive} onRefresh={plan.refresh} contentContainerClassName="flex-grow justify-center p-4 pb-24">
        <EmptyState icon="nutrition-outline" title={t("mealReg.noPlanTitle")} subtitle={t("mealReg.noPlanHint")} />
      </Screen>
    );
  }

  const p = plan.plan;
  const cycling = p.day_cycling;
  const items = todayMeals(p, plan.day, reg.registrations);
  const nextId = nextMealId(items);
  const openable = (id: string | null) =>
    items.some((i) => i.meal.id === id && i.registration == null && !i.noteOnly);
  const openMealId = openable(openId) ? openId : nextId;
  const { done, total } = doneCount(items);
  const nameOf = (meal: NutritionPlanMeal) => mealDisplayName(meal, (type) => t(`meals.${type}`));
  const sheetOptions = items.find((i) => i.meal.id === sheet?.meal.id)?.options ?? [];

  const save = (input: RegisterInput) => {
    setSheet(null);
    setOpenId(null);
    if (input.choice.kind !== "skipped") {
      const id = input.meal.id;
      popSeq.current += 1;
      const n = popSeq.current;
      setPopKeys((k) => ({ ...k, [id]: n }));
      setTimeout(() => {
        setPopKeys((k) => {
          if (k[id] !== n) return k;
          const rest = { ...k };
          delete rest[id];
          return rest;
        });
      }, POP_CLEAR_MS);
    }
    void reg.register(input);
  };

  const undo = (item: MealItem) => {
    setSheet(null);
    void reg.undo(item);
  };

  const changeDay = (day: ResolvedDay) => plan.setViewDay(day === plan.autoDay ? null : day);

  return (
    <>
      <Screen entering={arrive} onRefresh={plan.refresh} contentContainerClassName="p-4 gap-3 pb-24">
        <TodayCard
          target={targetFor(p, plan.day)}
          todays={reg.todays}
          onRetry={() => void reg.retry(itemsOf(reg.todays))}
        />

        <View className="min-h-[24px] flex-row items-center justify-between gap-3">
          {cycling ? <DayTypeChip day={plan.day} overridden={plan.overridden} onChange={changeDay} /> : <View />}
          {total > 0 && (
            <CapsLabel size={8.5} em={0.16} className="font-extrabold text-content-tertiary">
              {t("mealReg.doneCount", { done, count: total })}
            </CapsLabel>
          )}
        </View>

        {/* The meals follow the day type: the swap shows the change. A plan
            that doesn't cycle shows the same meals every day. */}
        <Swap
          id={cycling ? plan.day : "all"}
          order={cycling ? (plan.day === "training" ? 0 : 1) : undefined}
          className="gap-2.5"
        >
          {items.map((item) =>
            item.noteOnly ? (
              <NotTodayRow key={item.meal.id} name={nameOf(item.meal)} note={item.meal.notes ?? ""} />
            ) : (
              <MealCard
                key={item.meal.id}
                item={item}
                name={nameOf(item.meal)}
                isNext={item.meal.id === nextId}
                open={item.meal.id === openMealId}
                day={plan.day}
                cycling={cycling}
                popKey={popKeys[item.meal.id] ?? 0}
                onOpen={() => setOpenId(item.meal.id)}
                onRegister={(optionId) =>
                  setSheet({ meal: item.meal, name: nameOf(item.meal), registration: null, preselectOptionId: optionId })
                }
                onEdit={() =>
                  setSheet({
                    meal: item.meal,
                    name: nameOf(item.meal),
                    registration: item.registration,
                    preselectOptionId: null,
                  })
                }
                onRetry={() => {
                  if (item.registration != null) void reg.retry([item.registration]);
                }}
              />
            ),
          )}
        </Swap>

        <ShoppingListCard plan={p} />

        {p.notes != null && p.notes.trim() !== "" && (
          <Card className="gap-1.5">
            <CapsLabel size={8.5} em={0.16} className="font-extrabold text-content-tertiary">
              {t("mealReg.coachNotes")}
            </CapsLabel>
            <Text className="text-[13px] text-content-secondary">{p.notes}</Text>
          </Card>
        )}
      </Screen>

      <RegistrationSheet
        target={sheet}
        options={sheetOptions}
        day={plan.day}
        cycling={cycling}
        online={online}
        onClose={() => setSheet(null)}
        onSave={save}
        onUndo={undo}
      />
    </>
  );
}

function SupplementsPane({
  supplements,
  day,
  cycling,
}: {
  supplements: ReturnType<typeof useSupplementPlan>;
  day: ResolvedDay;
  cycling: boolean;
}) {
  const { t } = useTranslation();
  // The day-reactive key: ticks start over at midnight with the tab open.
  const today = useToday();
  const intake = useSupplementLog(toDateKey(today));
  const arrive = useArrival(supplements.loading && supplements.plan == null);

  if (supplements.loading && supplements.plan == null) return <LoadingBlock />;
  if (supplements.error && supplements.plan == null) {
    return <ErrorState onRetry={supplements.refresh} />;
  }
  if (supplements.plan == null) {
    return (
      <Screen
        entering={arrive}
        onRefresh={supplements.refresh}
        contentContainerClassName="flex-grow justify-center p-4 pb-24"
      >
        <EmptyState
          icon="medkit-outline"
          title={t("supplements.noPlanTitle")}
          subtitle={t("supplements.noPlanHint")}
        />
      </Screen>
    );
  }

  return (
    <Screen entering={arrive} onRefresh={supplements.refresh} contentContainerClassName="p-4 gap-3 pb-24">
      <SupplementStackView
        plan={supplements.plan}
        day={day}
        cycling={cycling}
        isTaken={intake.isTaken}
        onToggleTaken={(name) => void intake.setTaken(name, !intake.isTaken(name))}
      />
    </Screen>
  );
}
