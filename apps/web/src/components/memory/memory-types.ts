export type Tone = "concise" | "balanced" | "detailed";
export type Friendliness = "neutral" | "friendly" | "very-friendly";
export type Warmth = "neutral" | "warm" | "very-warm";
export type EmojiStyle = "none" | "light" | "expressive";

export type ProfileState = {
  instructions: string;
  tone: Tone;
  friendliness: Friendliness;
  warmth: Warmth;
  emojiStyle: EmojiStyle;
  autoMemory: boolean;
};

export const DEFAULT_PROFILE: ProfileState = {
  instructions: "",
  tone: "balanced",
  friendliness: "friendly",
  warmth: "warm",
  emojiStyle: "light",
  autoMemory: true,
};

export type MemoryUiState = {
  profile: ProfileState;
  instructionsDraft: string;
  profileInitialized: boolean;
  newMemory: string;
  isClearDialogOpen: boolean;
};

export type MemoryUiAction =
  | { type: "syncProfile"; profile: ProfileState }
  | { type: "setProfile"; profile: ProfileState }
  | { type: "setInstructionsDraft"; value: string }
  | { type: "setNewMemory"; value: string }
  | { type: "setClearDialogOpen"; value: boolean };

export function memoryUiReducer(state: MemoryUiState, action: MemoryUiAction): MemoryUiState {
  switch (action.type) {
    case "syncProfile":
      return {
        ...state,
        profile: action.profile,
        instructionsDraft: action.profile.instructions,
        profileInitialized: true,
      };
    case "setProfile":
      return {
        ...state,
        profile: action.profile,
      };
    case "setInstructionsDraft":
      return {
        ...state,
        instructionsDraft: action.value,
      };
    case "setNewMemory":
      return {
        ...state,
        newMemory: action.value,
      };
    case "setClearDialogOpen":
      return {
        ...state,
        isClearDialogOpen: action.value,
      };
  }
}
