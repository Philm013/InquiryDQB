import { writable } from 'svelte/store';

export interface BoardItem {
  id: string;
  type: string;
  sub?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  src?: string;
  author?: string;
  icon?: string;
  locked?: boolean;
  groupId?: string;
  parentZone?: string;
  children?: string[];
  title?: string;
  color?: string;
  zoneType?: string;
  exitMode?: string;
  prompt?: string;
  opts?: any[];
  data?: any[];
  ang?: number;
  isOpen?: boolean;
  z?: number;
}

export interface BoardState {
  items: BoardItem[];
  ink: any[];
  selection: string[];
  view: {
    x: number;
    y: number;
    z: number;
  };
}

const initialState: BoardState = {
  items: [],
  ink: [],
  selection: [],
  view: { x: 0, y: 0, z: 1 },
};

function createBoardStore() {
  const { subscribe, set, update } = writable(initialState);

  return {
    subscribe,
    set,
    update,
    // Add item
    addItem: (item: BoardItem) => update(state => {
      return { ...state, items: [...state.items, item] };
    }),
    // Delete item
    deleteItem: (id: string) => update(state => {
      return { ...state, items: state.items.filter(i => i.id !== id) };
    }),
    // Set selection
    setSelection: (selection: string[]) => update(state => {
      return { ...state, selection };
    }),
    // Add to selection
    addToSelection: (id: string) => update(state => {
        if (state.selection.includes(id)) {
            return state;
        }
        return { ...state, selection: [...state.selection, id] };
    }),
    // Remove from selection
    removeFromSelection: (id: string) => update(state => {
        return { ...state, selection: state.selection.filter(selId => selId !== id) };
    }),
    // Clear selection
    clearSelection: () => update(state => {
        return { ...state, selection: [] };
    }),
  };
}

export const boardStore = createBoardStore();
