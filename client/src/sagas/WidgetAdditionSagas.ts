import type { ReduxAction } from "@appsmith/constants/ReduxActionConstants";
import {
  ReduxActionErrorTypes,
  ReduxActionTypes,
  WidgetReduxActionTypes,
} from "@appsmith/constants/ReduxActionConstants";
import { ENTITY_TYPE } from "@appsmith/entities/AppsmithConsole/utils";
import type { WidgetBlueprint } from "WidgetProvider/constants";
import {
  BlueprintOperationTypes,
  GRID_DENSITY_MIGRATION_V1,
} from "WidgetProvider/constants";
import WidgetFactory from "WidgetProvider/factory";
import { generateAutoHeightLayoutTreeAction } from "actions/autoHeightActions";
import type { WidgetAddChild } from "actions/pageActions";
import { updateAndSaveLayout } from "actions/pageActions";
import {
  BUILDING_BLOCK_EXPLORER_TYPE,
  RenderModes,
} from "constants/WidgetConstants";
import { toast } from "design-system";
import type { DataTree } from "entities/DataTree/dataTreeTypes";
import produce from "immer";
import { klona as clone } from "klona/full";
import { getWidgetMinMaxDimensionsInPixel } from "layoutSystems/autolayout/utils/flexWidgetUtils";
import { ResponsiveBehavior } from "layoutSystems/common/utils/constants";
import { isFunction } from "lodash";
import omit from "lodash/omit";
import log from "loglevel";
import type {
  CanvasWidgetsReduxState,
  FlattenedWidgetProps,
} from "reducers/entityReducers/canvasWidgetsReducer";
import { all, call, put, select, takeEvery } from "redux-saga/effects";
import { getDataTree } from "selectors/dataTreeSelectors";
import {
  getCanvasWidth,
  getIsAutoLayout,
  getIsAutoLayoutMobileBreakPoint,
} from "selectors/editorSelectors";
import AppsmithConsole from "utils/AppsmithConsole";
import { getNextEntityName } from "utils/AppsmithUtils";
import { generateWidgetProps } from "utils/WidgetPropsUtils";
import { generateReactKey } from "utils/generators";
import type { WidgetProps } from "widgets/BaseWidget";
import { isStack } from "../layoutSystems/autolayout/utils/AutoLayoutUtils";
import {
  buildWidgetBlueprint,
  executeWidgetBlueprintBeforeOperations,
  executeWidgetBlueprintOperations,
  traverseTreeAndExecuteBlueprintChildOperations,
} from "./WidgetBlueprintSagas";
import { getPropertiesToUpdate } from "./WidgetOperationSagas";
import { getWidget, getWidgets } from "./selectors";
import { addBuildingBlockToCanvasSaga } from "./BuildingBlockAdditionSagas";
import { getCurrentlyOpenAnvilDetachedWidgets } from "layoutSystems/anvil/integrations/modalSelectors";

const WidgetTypes = WidgetFactory.widgetTypes;

export interface GeneratedWidgetPayload {
  widgetId: string;
  widgets: { [widgetId: string]: FlattenedWidgetProps };
}

interface WidgetAddTabChild {
  tabs: any;
  widgetId: string;
}

function* getEntityNames() {
  const evalTree: DataTree = yield select(getDataTree);
  return Object.keys(evalTree);
}

function* getChildWidgetProps(
  parent: FlattenedWidgetProps,
  params: WidgetAddChild,
  widgets: { [widgetId: string]: FlattenedWidgetProps },
) {
  const { leftColumn, newWidgetId, topRow, type } = params;

  let { columns, parentColumnSpace, parentRowSpace, props, rows, widgetName } =
    params;
  let minHeight = undefined;
  const restDefaultConfig = omit(WidgetFactory.widgetConfigMap.get(type), [
    "blueprint",
  ]);
  const themeDefaultConfig =
    WidgetFactory.getWidgetStylesheetConfigMap(type) || {};
  const widgetSessionValues = getWidgetSessionValues(type, parent);
  const mainCanvasWidth: number = yield select(getCanvasWidth);
  const isMobile: boolean = yield select(getIsAutoLayoutMobileBreakPoint);
  const detachedWidgets: string[] = yield select(
    getCurrentlyOpenAnvilDetachedWidgets,
  );
  const isModalOpen = detachedWidgets && detachedWidgets.length > 0;

  if (!widgetName) {
    const widgetNames = Object.keys(widgets).map((w) => widgets[w].widgetName);
    const entityNames: string[] = yield call(getEntityNames);

    widgetName = getNextEntityName(restDefaultConfig.widgetName, [
      ...widgetNames,
      ...entityNames,
    ]);
  }
  if (type === "CANVAS_WIDGET") {
    columns =
      (parent.rightColumn - parent.leftColumn) * parent.parentColumnSpace;
    parentColumnSpace = 1;
    rows = (parent.bottomRow - parent.topRow) * parent.parentRowSpace;
    parentRowSpace = 1;
    minHeight = rows;
    // if (props) props.children = [];

    if (props) {
      props = produce(props, (draft: WidgetProps) => {
        if (!draft.children || !Array.isArray(draft.children)) {
          draft.children = [];
        }
      });
    }
  }

  // in case we are creating zone inside zone, we want to use the parent's column space, we want
  // to make sure the elevateBackground is set to false
  if (type === "ZONE_WIDGET" && isModalOpen) {
    props = { ...props, elevatedBackground: false };
  }

  const isAutoLayout = isStack(widgets, parent);
  const isFillWidget =
    restDefaultConfig?.responsiveBehavior === ResponsiveBehavior.Fill;
  if (isAutoLayout && isFillWidget) columns = 64;

  const widgetProps = {
    ...restDefaultConfig,
    ...props,
    columns,
    rows,
    minHeight,
    widgetId: newWidgetId,
    renderMode: RenderModes.CANVAS,
    ...themeDefaultConfig,
    ...widgetSessionValues,
  };

  const { minWidth } = getWidgetMinMaxDimensionsInPixel(
    widgetProps,
    mainCanvasWidth,
  );

  // If the width of new widget is less than min width, set the width to min width
  if (minWidth && columns * parentColumnSpace < minWidth) {
    columns = minWidth / parentColumnSpace;
  }

  const widget = generateWidgetProps(
    parent,
    type,
    leftColumn,
    topRow,
    parentRowSpace,
    parentColumnSpace,
    widgetName,
    widgetProps,
    restDefaultConfig.version,
  );

  let { disableResizeHandles } = WidgetFactory.getWidgetAutoLayoutConfig(type);
  if (isFunction(disableResizeHandles)) {
    disableResizeHandles = disableResizeHandles(widget);
  }

  if (isAutoLayout) {
    // For hug widgets with horizontal resizing enabled, set the initial value for widthInPercentage
    if (!isFillWidget && !disableResizeHandles?.horizontal) {
      if (isMobile) {
        widget.mobileWidthInPercentage =
          (columns * parentColumnSpace) / mainCanvasWidth;
      } else {
        widget.widthInPercentage =
          (columns * parentColumnSpace) / mainCanvasWidth;
      }
    }
  }

  widget.widgetId = newWidgetId;
  /**
   * un-evaluated childStylesheet used by widgets; so they are to be excluded
   * from the dynamicBindingPathList and they are not included as a part of
   * the props send to getPropertiesToUpdate.
   */
  const themeConfigWithoutChildStylesheet = omit(
    themeDefaultConfig,
    "childStylesheet",
  );

  /**
   * TODO: Balaji Soundararajan @sbalaji1192
   * We are not getting all the paths with dynamic value here. Therefore we
   * are not adding them to the dynamic binding path list. This creates an issue
   * when adding a new widget that has a property with dynamic value resulting
   * in an unevaluated value.
   * Furthermore, even if use all the widget paths instead of the updates paths
   * in the getPropertiesToUpdate function, we have to omit the blueprint paths.
   */
  const { dynamicBindingPathList } = yield call(
    getPropertiesToUpdate,
    widget,
    themeConfigWithoutChildStylesheet,
  );

  if (params.dynamicBindingPathList) {
    const mergedDynamicBindingPathLists = [
      ...dynamicBindingPathList,
      ...params.dynamicBindingPathList,
    ];
    widget.dynamicBindingPathList = mergedDynamicBindingPathLists;
  } else {
    widget.dynamicBindingPathList = clone(dynamicBindingPathList);
  }

  return widget;
}

export function* generateChildWidgets(
  parent: FlattenedWidgetProps,
  params: WidgetAddChild,
  widgets: { [widgetId: string]: FlattenedWidgetProps },
  propsBlueprint?: WidgetBlueprint,
): any {
  // Get the props for the widget
  const widget = yield getChildWidgetProps(parent, params, widgets);

  // Add the widget to the canvasWidgets
  // We need this in here as widgets will be used to get the current widget
  widgets[widget.widgetId] = widget;

  // Get the default config for the widget from WidgetConfigResponse
  const defaultConfig = { ...WidgetFactory.widgetConfigMap.get(widget.type) };

  // If blueprint is provided in the params, use that
  // else use the blueprint available in WidgetConfigResponse
  // else there is no blueprint for this widget
  const blueprint =
    propsBlueprint || { ...defaultConfig?.blueprint } || undefined;

  // If there is a blueprint.view
  // We need to generate the children based on the view
  if (blueprint && blueprint.view) {
    // Get the list of children props in WidgetAddChild format
    const childWidgetList: WidgetAddChild[] = yield call(
      buildWidgetBlueprint,
      blueprint,
      widget.widgetId,
    );
    // For each child props
    const childPropsList: GeneratedWidgetPayload[] = yield all(
      childWidgetList.map((props: WidgetAddChild) => {
        // Generate full widget props
        // Notice that we're passing the blueprint if it exists.
        return generateChildWidgets(
          widget,
          props,
          widgets,
          props.props?.blueprint,
        );
      }),
    );
    // Start children array from scratch
    widget.children = [];
    childPropsList.forEach((props: GeneratedWidgetPayload) => {
      // Push the widgetIds of the children generated above into the widget.children array
      widget.children.push(props.widgetId);
      // Add the list of widgets generated into the canvasWidgets
      widgets = props.widgets;
    });
  }

  // Finally, add the widget to the canvasWidgets
  // This is different from above, as this is the final widget props with
  // a fully populated widget.children property
  widgets[widget.widgetId] = widget;

  // Some widgets need to run a few operations like modifying props or adding an action
  // these operations can be performed on the parent of the widget we're adding
  // therefore, we pass all widgets to executeWidgetBlueprintOperations
  // blueprint.operations contain the set of operations to perform to update the canvasWidgets
  if (blueprint && blueprint.operations && blueprint.operations.length > 0) {
    // Finalize the canvasWidgets with everything that needs to be updated
    widgets = yield call(
      executeWidgetBlueprintOperations,
      blueprint.operations,
      widgets,
      widget.widgetId,
    );
  }

  // Add the parentId prop to this widget
  widget.parentId = parent.widgetId;
  // Remove the blueprint from the widget (if any)
  // as blueprints are not useful beyond this point.
  delete widget.blueprint;

  // deleting propertyPaneEnchancements too as it shouldn't go in dsl because
  // function can't be cloned into dsl

  // instead of passing whole enhancments function in widget props, we are just setting
  // enhancments as true so that we know this widget contains enhancments
  if ("enhancements" in widget) {
    widget.enhancements = true;
  }

  return { widgetId: widget.widgetId, widgets };
}

export function* getUpdateDslAfterCreatingChild(
  addChildPayload: WidgetAddChild,
) {
  // NOTE: widgetId here is the parentId of the dropped widget ( we should rename it to avoid confusion )
  const { widgetId } = addChildPayload;
  // Get the current parent widget whose child will be the new widget.
  const stateParent: FlattenedWidgetProps = yield select(getWidget, widgetId);
  // const parent = Object.assign({}, stateParent);
  // Get all the widgets from the canvasWidgetsReducer
  const stateWidgets: CanvasWidgetsReduxState = yield select(getWidgets);
  const widgets = Object.assign({}, stateWidgets);
  // Generate the full WidgetProps of the widget to be added.
  const childWidgetPayload: GeneratedWidgetPayload = yield generateChildWidgets(
    stateParent,
    addChildPayload,
    widgets,
    // sending blueprint for onboarding usecase
    addChildPayload.props?.blueprint,
  );

  // Update widgets to put back in the canvasWidgetsReducer
  // TODO(abhinav): This won't work if dont already have an empty children: []
  const parent = {
    ...stateParent,
    children: [...(stateParent.children || []), childWidgetPayload.widgetId],
  };

  widgets[parent.widgetId] = parent;
  AppsmithConsole.info({
    text: "Widget was created",
    source: {
      type: ENTITY_TYPE.WIDGET,
      id: childWidgetPayload.widgetId,
      name: childWidgetPayload.widgets[childWidgetPayload.widgetId].widgetName,
    },
  });
  yield put({
    type: WidgetReduxActionTypes.WIDGET_CHILD_ADDED,
    payload: {
      widgetId: childWidgetPayload.widgetId,
      type: addChildPayload.type,
    },
  });
  // some widgets need to update property of parent if the parent have CHILD_OPERATIONS
  // so here we are traversing up the tree till we get to MAIN_CONTAINER_WIDGET_ID
  // while traversing, if we find any widget which has CHILD_OPERATION, we will call the fn in it
  const updatedWidgets: CanvasWidgetsReduxState = yield call(
    traverseTreeAndExecuteBlueprintChildOperations,
    parent,
    [addChildPayload.newWidgetId],
    widgets,
  );

  return updatedWidgets;
}

/**
 * this saga is called when we drop a widget on the canvas.
 *
 * @param addChildAction
 */
export function* addChildSaga(
  addChildAction: ReduxAction<
    WidgetAddChild & {
      shouldReplay?: boolean;
    }
  >,
) {
  try {
    const start = performance.now();
    toast.dismiss();
    const stateWidgets: CanvasWidgetsReduxState = yield select(getWidgets);
    const { newWidgetId, type, widgetId } = addChildAction.payload;

    yield call(
      executeWidgetBlueprintBeforeOperations,
      BlueprintOperationTypes.BEFORE_ADD,
      {
        parentId: widgetId,
        widgetId: newWidgetId,
        widgets: stateWidgets,
        widgetType: type,
      },
    );

    const updatedWidgets: {
      [widgetId: string]: FlattenedWidgetProps;
    } = yield call(getUpdateDslAfterCreatingChild, addChildAction.payload);
    yield put(
      updateAndSaveLayout(updatedWidgets, {
        shouldReplay: addChildAction.payload.shouldReplay,
      }),
    );
    yield put({
      type: ReduxActionTypes.RECORD_RECENTLY_ADDED_WIDGET,
      payload: [addChildAction.payload.newWidgetId],
    });
    yield put(generateAutoHeightLayoutTreeAction(true, true));

    log.debug("add child computations took", performance.now() - start, "ms");
    // go up till MAIN_CONTAINER, if there is a operation CHILD_OPERATIONS IN ANY PARENT,
    // call execute
  } catch (error) {
    yield put({
      type: ReduxActionErrorTypes.WIDGET_OPERATION_ERROR,
      payload: {
        action: WidgetReduxActionTypes.WIDGET_ADD_CHILD,
        error,
      },
    });
  }
}

const getChildTabData = (
  tabProps: WidgetProps,
  tab: {
    id: string;
    label: string;
    widgetId: string;
  },
) => {
  const columns =
    (tabProps.rightColumn - tabProps.leftColumn) * tabProps.parentColumnSpace;
  // GRID_DENSITY_MIGRATION_V1 used to adjust code as per new scaled canvas.
  const rows =
    (tabProps.bottomRow - tabProps.topRow - GRID_DENSITY_MIGRATION_V1) *
    tabProps.parentRowSpace;
  return {
    type: WidgetTypes.CANVAS_WIDGET,
    columns: columns,
    rows: rows,
    topRow: 1,
    newWidgetId: tab.widgetId,
    widgetId: tabProps.widgetId,
    leftColumn: 0,
    rightColumn:
      (tabProps.rightColumn - tabProps.leftColumn) * tabProps.parentColumnSpace,
    bottomRow: (tabProps.bottomRow - tabProps.topRow) * tabProps.parentRowSpace,
    props: {
      tabId: tab.id,
      tabName: tab.label,
      containerStyle: "none",
      canExtend: false,
      detachFromLayout: true,
      children: [],
    },
  };
};

function* addNewTabChildSaga(
  addChildTabAction: ReduxAction<WidgetAddTabChild>,
) {
  const { widgetId } = addChildTabAction.payload;
  const tabProps: WidgetProps = yield select(getWidget, widgetId);
  let tabs = tabProps.tabsObj;
  const tabsArray = Object.values(tabs);
  const newTabWidgetId = generateReactKey();
  const newTabId = generateReactKey({ prefix: "tab" });
  const newTabLabel = getNextEntityName(
    "Tab ",
    tabsArray.map((tab: any) => tab.label),
  );

  tabs = {
    ...tabs,
    [newTabId]: {
      id: newTabId,
      index: tabsArray.length,
      label: newTabLabel,
      widgetId: newTabWidgetId,
      isVisible: true,
    },
  };
  const newTabProps: any = getChildTabData(tabProps, {
    id: newTabId,
    label: newTabLabel,
    widgetId: newTabWidgetId,
  });
  const isAutoLayout: boolean = yield select(getIsAutoLayout);
  const updatedWidgets: CanvasWidgetsReduxState = yield call(
    getUpdateDslAfterCreatingChild,
    isAutoLayout ? { ...newTabProps, topRow: 0 } : newTabProps,
  );
  updatedWidgets[widgetId]["tabsObj"] = tabs;
  yield put(updateAndSaveLayout(updatedWidgets));
}

function* addUIEntitySaga(addEntityAction: ReduxAction<WidgetAddChild>) {
  try {
    const { payload } = addEntityAction;
    const { type } = payload;

    if (type === BUILDING_BLOCK_EXPLORER_TYPE) {
      yield call(addBuildingBlockToCanvasSaga, addEntityAction);
    } else {
      yield call(addChildSaga, addEntityAction);
    }
  } catch (error) {
    yield put({
      type: ReduxActionErrorTypes.WIDGET_OPERATION_ERROR,
      payload: {
        action: WidgetReduxActionTypes.WIDGET_ADD_CHILD,
        error,
      },
    });
  }
}

export default function* widgetAdditionSagas() {
  yield all([
    takeEvery(WidgetReduxActionTypes.WIDGET_ADD_CHILD, addUIEntitySaga),
    takeEvery(ReduxActionTypes.WIDGET_ADD_NEW_TAB_CHILD, addNewTabChildSaga),
  ]);
}

/**
 * retrieves the values from session storage for the widget properties
 * for hydration of the widget when we create widget on drop
 */
export function getWidgetSessionValues(
  type: string,
  parent: FlattenedWidgetProps,
) {
  // For WDS_INLINE_BUTTONS_WIDGET, we want to hydation only to work when we add more items to the inline button group.
  // So we don't want to hydrate the values when we drop the widget on the canvas.
  if (["WDS_INLINE_BUTTONS_WIDGET"].includes(type)) return;

  let widgetType = type;
  const configMap = WidgetFactory.widgetConfigMap.get(type);
  const widgetSessionValues: any = {};

  // in case we are dropping WDS_ICON_BUTTON_WIDGET, we want to reuse the values of BUTTON_WIDGET
  if (type === "WDS_ICON_BUTTON_WIDGET") {
    widgetType = "WDS_BUTTON_WIDGET";
  }

  for (const key in configMap) {
    if (configMap[key]) {
      let sessionStorageKey = `${widgetType}.${key}`;

      if (type === "ZONE_WIDGET") {
        sessionStorageKey = `${widgetType}.${parent.widgetId}.${key}`;
      }

      let valueFromSession: any = sessionStorage.getItem(sessionStorageKey);

      // parse "true" as true and "false" as false
      if (valueFromSession === "true") {
        valueFromSession = true;
      } else if (valueFromSession === "false") {
        valueFromSession = false;
      }

      if (valueFromSession !== undefined && valueFromSession !== null) {
        widgetSessionValues[key] = valueFromSession;
      }
    }
  }

  return widgetSessionValues;
}