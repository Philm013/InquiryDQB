import { writable } from 'svelte/store';

export interface UIState {
  tool: string;
  activeDrawer: string | null;
  activeModal: string | null;
  sidebarOpen: boolean;
}

const initialState: UIState = {
  tool: 'pan',
  activeDrawer: null,
  activeModal: null,
  sidebarOpen: false,
};

function createUIStore() {
  const { subscribe, set, update } = writable(initialState);

  return {
    subscribe,
    setTool: (tool: string) => update(state => ({ ...state, tool })),
    toggleDrawer: (drawer: string | null) => update(state => {
      if (state.activeDrawer === drawer) {
        return { ...state, activeDrawer: null };
      }
      return { ...state, activeDrawer: drawer };
    }),
    showModal: (modal: string) => update(state => ({ ...state, activeModal: modal })),
    hideModal: () => update(state => ({ ...state, activeModal: null })),
    toggleSidebar: () => update(state => ({ ...state, sidebarOpen: !state.sidebarOpen })),
  };
}

export const uiStore = createUIStore();
