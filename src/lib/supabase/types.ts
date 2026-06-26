export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type ReadingStatus = "pending_payment" | "awaiting_response" | "responded" | "revealed" | "expired";
export type Orientation = "upright" | "reversed";
export type SpreadType = "single" | "three";
export type UserRole = "reader" | "admin";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          email: string | null;
          role: UserRole;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["profiles"]["Row"], "created_at"> & Partial<Pick<Database["public"]["Tables"]["profiles"]["Row"], "created_at">>;
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
      };
      cards: {
        Row: {
          id: number;
          name: string;
          arcana: "major" | "minor";
          suit: "wands" | "cups" | "swords" | "pentacles" | null;
          number: number | null;
          image_path: string;
          upright_meaning: string;
          reversed_meaning: string;
          keywords: string[] | null;
          flower_species: string | null;
        };
        Insert: Database["public"]["Tables"]["cards"]["Row"];
        Update: Partial<Database["public"]["Tables"]["cards"]["Row"]>;
      };
      readings: {
        Row: {
          id: string;
          session_token: string;
          spread_type: SpreadType;
          question_audio_path: string;
          question_duration_ms: number | null;
          email: string | null;
          status: ReadingStatus;
          payment_screenshot_path: string;
          payment_verified_at: string | null;
          verified_by: string | null;
          claimed_by: string | null;
          claimed_at: string | null;
          response_audio_path: string | null;
          response_duration_ms: number | null;
          created_at: string;
          expires_at: string;
          responded_at: string | null;
          revealed_at: string | null;
        };
        Insert: Omit<Database["public"]["Tables"]["readings"]["Row"], "id" | "created_at" | "expires_at"> & Partial<Pick<Database["public"]["Tables"]["readings"]["Row"], "id" | "created_at" | "expires_at">>;
        Update: Partial<Database["public"]["Tables"]["readings"]["Row"]>;
      };
      reading_cards: {
        Row: {
          id: string;
          reading_id: string;
          card_id: number;
          position: number;
          is_reversed: boolean;
        };
        Insert: Omit<Database["public"]["Tables"]["reading_cards"]["Row"], "id"> & Partial<Pick<Database["public"]["Tables"]["reading_cards"]["Row"], "id">>;
        Update: Partial<Database["public"]["Tables"]["reading_cards"]["Row"]>;
      };
    };
  };
}
