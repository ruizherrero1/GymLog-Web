export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      gymlog_google_connections: {
        Row: {
          backup_file_id: string | null
          backup_file_url: string | null
          created_at: string
          google_health_refresh_token: string | null
          google_refresh_token: string
          google_scopes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          backup_file_id?: string | null
          backup_file_url?: string | null
          created_at?: string
          google_health_refresh_token?: string | null
          google_refresh_token: string
          google_scopes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          backup_file_id?: string | null
          backup_file_url?: string | null
          created_at?: string
          google_health_refresh_token?: string | null
          google_refresh_token?: string
          google_scopes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gymlog_health_recovery_queue: {
        Row: {
          attempt: number
          created_at: string
          due_at: string
          last_error: string | null
          session_local_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt: number
          created_at?: string
          due_at: string
          last_error?: string | null
          session_local_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt?: number
          created_at?: string
          due_at?: string
          last_error?: string | null
          session_local_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gymlog_health_recovery_queue_user_id_session_local_id_fkey"
            columns: ["user_id", "session_local_id"]
            isOneToOne: false
            referencedRelation: "gymlog_sessions"
            referencedColumns: ["user_id", "local_id"]
          },
        ]
      }
      gymlog_heart_rate_samples: {
        Row: {
          bpm: number
          created_at: string
          sample_index: number
          sample_time: string | null
          session_local_id: string
          source: string
          user_id: string
        }
        Insert: {
          bpm: number
          created_at?: string
          sample_index?: number
          sample_time?: string | null
          session_local_id: string
          source?: string
          user_id: string
        }
        Update: {
          bpm?: number
          created_at?: string
          sample_index?: number
          sample_time?: string | null
          session_local_id?: string
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gymlog_heart_rate_samples_user_id_session_local_id_fkey"
            columns: ["user_id", "session_local_id"]
            isOneToOne: false
            referencedRelation: "gymlog_sessions"
            referencedColumns: ["user_id", "local_id"]
          },
        ]
      }
      gymlog_oauth_states: {
        Row: {
          created_at: string
          expires_at: string
          return_to: string
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          return_to: string
          state: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          return_to?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      gymlog_session_exercises: {
        Row: {
          exercise_id: string | null
          exercise_index: number
          exercise_name: string | null
          exercise_type: string | null
          payload: Json
          session_local_id: string
          user_id: string
        }
        Insert: {
          exercise_id?: string | null
          exercise_index: number
          exercise_name?: string | null
          exercise_type?: string | null
          payload: Json
          session_local_id: string
          user_id: string
        }
        Update: {
          exercise_id?: string | null
          exercise_index?: number
          exercise_name?: string | null
          exercise_type?: string | null
          payload?: Json
          session_local_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gymlog_session_exercises_user_id_session_local_id_fkey"
            columns: ["user_id", "session_local_id"]
            isOneToOne: false
            referencedRelation: "gymlog_sessions"
            referencedColumns: ["user_id", "local_id"]
          },
        ]
      }
      gymlog_session_sets: {
        Row: {
          completed: boolean | null
          duration_seconds: number | null
          exercise_index: number
          payload: Json
          reps: number | null
          session_local_id: string
          set_index: number
          user_id: string
          weight: number | null
        }
        Insert: {
          completed?: boolean | null
          duration_seconds?: number | null
          exercise_index: number
          payload: Json
          reps?: number | null
          session_local_id: string
          set_index: number
          user_id: string
          weight?: number | null
        }
        Update: {
          completed?: boolean | null
          duration_seconds?: number | null
          exercise_index?: number
          payload?: Json
          reps?: number | null
          session_local_id?: string
          set_index?: number
          user_id?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gymlog_session_sets_user_id_session_local_id_exercise_inde_fkey"
            columns: ["user_id", "session_local_id", "exercise_index"]
            isOneToOne: false
            referencedRelation: "gymlog_session_exercises"
            referencedColumns: ["user_id", "session_local_id", "exercise_index"]
          },
        ]
      }
      gymlog_sessions: {
        Row: {
          checksum: string
          created_at: string
          deleted_at: string | null
          duration_seconds: number | null
          health_metrics_status: string | null
          health_summary: Json
          health_sync_status: string | null
          local_id: string
          payload: Json
          routine_id: string | null
          routine_name: string | null
          session_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          checksum: string
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          health_metrics_status?: string | null
          health_summary?: Json
          health_sync_status?: string | null
          local_id: string
          payload: Json
          routine_id?: string | null
          routine_name?: string | null
          session_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          checksum?: string
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          health_metrics_status?: string | null
          health_summary?: Json
          health_sync_status?: string | null
          local_id?: string
          payload?: Json
          routine_id?: string | null
          routine_name?: string | null
          session_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gymlog_state_snapshots: {
        Row: {
          checksum: string
          created_at: string
          data: Json
          reason: string
          revision: number
          snapshot_id: string
          user_id: string
        }
        Insert: {
          checksum: string
          created_at?: string
          data: Json
          reason: string
          revision: number
          snapshot_id?: string
          user_id: string
        }
        Update: {
          checksum?: string
          created_at?: string
          data?: Json
          reason?: string
          revision?: number
          snapshot_id?: string
          user_id?: string
        }
        Relationships: []
      }
      gymlog_sync_events: {
        Row: {
          code: string
          context: Json
          created_at: string
          event_id: number
          level: string
          message: string | null
          user_id: string
        }
        Insert: {
          code: string
          context?: Json
          created_at?: string
          event_id?: never
          level: string
          message?: string | null
          user_id: string
        }
        Update: {
          code?: string
          context?: Json
          created_at?: string
          event_id?: never
          level?: string
          message?: string | null
          user_id?: string
        }
        Relationships: []
      }
      gymlog_synced_sessions: {
        Row: {
          google_data_point_name: string
          local_id: string
          orphaned_at: string | null
          synced_at: string
          user_id: string
        }
        Insert: {
          google_data_point_name: string
          local_id: string
          orphaned_at?: string | null
          synced_at?: string
          user_id: string
        }
        Update: {
          google_data_point_name?: string
          local_id?: string
          orphaned_at?: string | null
          synced_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gymlog_user_preferences: {
        Row: {
          age: number | null
          heart_rate_zones: Json | null
          max_heart_rate: number | null
          resting_heart_rate: number | null
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          age?: number | null
          heart_rate_zones?: Json | null
          max_heart_rate?: number | null
          resting_heart_rate?: number | null
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          age?: number | null
          heart_rate_zones?: Json | null
          max_heart_rate?: number | null
          resting_heart_rate?: number | null
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gymlog_user_state: {
        Row: {
          created_at: string
          data: Json
          last_client_id: string | null
          revision: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          last_client_id?: string | null
          revision?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          last_client_id?: string | null
          revision?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gymlog_weights: {
        Row: {
          payload: Json
          updated_at: string
          user_id: string
          weight_date: string
          weight_kg: number
        }
        Insert: {
          payload: Json
          updated_at?: string
          user_id: string
          weight_date: string
          weight_kg: number
        }
        Update: {
          payload?: Json
          updated_at?: string
          user_id?: string
          weight_date?: string
          weight_kg?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      gymlog_create_state_snapshot: {
        Args: { p_reason: string }
        Returns: Json
      }
      gymlog_save_user_state: {
        Args: {
          p_client_id?: string
          p_data: Json
          p_expected_revision: number
          p_snapshot_reason?: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
