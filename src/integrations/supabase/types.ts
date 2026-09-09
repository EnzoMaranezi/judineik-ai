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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      ai_generation_events: {
        Row: {
          action_id: string | null
          completed_at: string | null
          created_at: string
          document_id: string | null
          id: string
          kind: string
          locale: string
          reserved_until: string
          status: string
          topic_id: string | null
          topic_scope_id: string | null
          usage_date: string
          user_id: string
        }
        Insert: {
          action_id?: string | null
          completed_at?: string | null
          created_at?: string
          document_id?: string | null
          id?: string
          kind: string
          locale: string
          reserved_until: string
          status: string
          topic_id?: string | null
          topic_scope_id?: string | null
          usage_date?: string
          user_id: string
        }
        Update: {
          action_id?: string | null
          completed_at?: string | null
          created_at?: string
          document_id?: string | null
          id?: string
          kind?: string
          locale?: string
          reserved_until?: string
          status?: string
          topic_id?: string | null
          topic_scope_id?: string | null
          usage_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_generation_events_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generation_events_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "document_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_ip_generation_events: {
        Row: {
          completed_at: string | null
          created_at: string
          ip_digest: string
          key_version: number
          reservation_id: string
          reserved_until: string
          status: string
          usage_date: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          ip_digest: string
          key_version: number
          reservation_id: string
          reserved_until: string
          status: string
          usage_date: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          ip_digest?: string
          key_version?: number
          reservation_id?: string
          reserved_until?: string
          status?: string
          usage_date?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          created_at: string
          extracted_at: string | null
          extracted_text: string | null
          extraction_error: string | null
          file_url: string | null
          id: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          extracted_at?: string | null
          extracted_text?: string | null
          extraction_error?: string | null
          file_url?: string | null
          id?: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          extracted_at?: string | null
          extracted_text?: string | null
          extraction_error?: string | null
          file_url?: string | null
          id?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      document_topics: {
        Row: {
          created_at: string
          description: string
          discovery_model: string | null
          document_id: string
          id: string
          position: number
          source_hash: string
          source_ranges: Json
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description: string
          discovery_model?: string | null
          document_id: string
          id?: string
          position: number
          source_hash: string
          source_ranges: Json
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          discovery_model?: string | null
          document_id?: string
          id?: string
          position?: number
          source_hash?: string
          source_ranges?: Json
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_topics_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      flashcard_sets: {
        Row: { created_at: string; document_id: string; id: string; locale: string; model: string | null; topic_id: string | null; updated_at: string; user_id: string }
        Insert: { created_at?: string; document_id: string; id?: string; locale: string; model?: string | null; topic_id?: string | null; updated_at?: string; user_id: string }
        Update: { created_at?: string; document_id?: string; id?: string; locale?: string; model?: string | null; topic_id?: string | null; updated_at?: string; user_id?: string }
        Relationships: [
          { foreignKeyName: "flashcard_sets_document_id_fkey"; columns: ["document_id"]; isOneToOne: false; referencedRelation: "documents"; referencedColumns: ["id"] },
          { foreignKeyName: "flashcard_sets_topic_id_fkey"; columns: ["topic_id"]; isOneToOne: false; referencedRelation: "document_topics"; referencedColumns: ["id"] },
        ]
      }
      flashcards: {
        Row: { back: string; created_at: string; due_at: string; ease_factor: number; flashcard_set_id: string; front: string; id: string; interval_days: number; last_reviewed_at: string | null; position: number; repetitions: number }
        Insert: { back: string; created_at?: string; due_at?: string; ease_factor?: number; flashcard_set_id: string; front: string; id?: string; interval_days?: number; last_reviewed_at?: string | null; position: number; repetitions?: number }
        Update: { back?: string; created_at?: string; due_at?: string; ease_factor?: number; flashcard_set_id?: string; front?: string; id?: string; interval_days?: number; last_reviewed_at?: string | null; position?: number; repetitions?: number }
        Relationships: [{ foreignKeyName: "flashcards_flashcard_set_id_fkey"; columns: ["flashcard_set_id"]; isOneToOne: false; referencedRelation: "flashcard_sets"; referencedColumns: ["id"] }]
      }
      flashcard_reviews: {
        Row: { flashcard_id: string; id: string; next_due_at: string; next_interval_days: number; previous_due_at: string; previous_interval_days: number; rating: string; reviewed_at: string; user_id: string }
        Insert: { flashcard_id: string; id?: string; next_due_at: string; next_interval_days: number; previous_due_at: string; previous_interval_days: number; rating: string; reviewed_at?: string; user_id: string }
        Update: { flashcard_id?: string; id?: string; next_due_at?: string; next_interval_days?: number; previous_due_at?: string; previous_interval_days?: number; rating?: string; reviewed_at?: string; user_id?: string }
        Relationships: [{ foreignKeyName: "flashcard_reviews_flashcard_id_fkey"; columns: ["flashcard_id"]; isOneToOne: false; referencedRelation: "flashcards"; referencedColumns: ["id"] }]
      }
      question_sessions: {
        Row: {
          accuracy: number
          answers: Json
          completed_at: string | null
          correct_answers: number
          created_at: string
          document_id: string
          id: string
          question_set_id: string | null
          started_at: string
          total_questions: number
          updated_at: string
          user_id: string
        }
        Insert: {
          accuracy: number
          answers?: Json
          completed_at?: string | null
          correct_answers: number
          created_at?: string
          document_id: string
          id?: string
          question_set_id?: string | null
          started_at?: string
          total_questions: number
          updated_at?: string
          user_id: string
        }
        Update: {
          accuracy?: number
          answers?: Json
          completed_at?: string | null
          correct_answers?: number
          created_at?: string
          document_id?: string
          id?: string
          question_set_id?: string | null
          started_at?: string
          total_questions?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_sessions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_sessions_question_set_id_fkey"
            columns: ["question_set_id"]
            isOneToOne: false
            referencedRelation: "question_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      question_sets: {
        Row: {
          created_at: string
          document_id: string
          id: string
          kind: string
          locale: string
          model: string | null
          questions: Json
          source_question_set_id: string | null
          superseded_at: string | null
          topic_id: string | null
          topic_scope_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          id?: string
          kind: string
          locale: string
          model?: string | null
          questions: Json
          source_question_set_id?: string | null
          superseded_at?: string | null
          topic_id?: string | null
          topic_scope_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          id?: string
          kind?: string
          locale?: string
          model?: string | null
          questions?: Json
          source_question_set_id?: string | null
          superseded_at?: string | null
          topic_id?: string | null
          topic_scope_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_sets_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_sets_source_question_set_id_fkey"
            columns: ["source_question_set_id"]
            isOneToOne: false
            referencedRelation: "question_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_sets_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "document_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      summaries: {
        Row: {
          content: Json
          created_at: string
          document_id: string
          id: string
          locale: string
          model: string | null
          topic_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: Json
          created_at?: string
          document_id: string
          id?: string
          locale: string
          model?: string | null
          topic_id?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: Json
          created_at?: string
          document_id?: string
          id?: string
          locale?: string
          model?: string | null
          topic_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "summaries_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "summaries_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "document_topics"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      finish_ai_generation: {
        Args: {
          p_authorization: string
          p_ip_digest: string
          p_issued_at: number
          p_key_version: number
          p_reservation_id: string
          p_status: string
          p_usage_date: string
        }
        Returns: string
      }
      create_flashcard_set_with_cards: {
        Args: { p_cards: Json; p_document_id: string; p_locale: string; p_model: string | null; p_topic_id?: string | null }
        Returns: string
      }
      create_document_topics: {
        Args: {
          p_discovery_model: string | null
          p_document_id: string
          p_source_hash: string
          p_topics: Json
        }
        Returns: Database["public"]["Tables"]["document_topics"]["Row"][]
      }
      create_question_set_version: {
        Args: {
          p_document_id: string
          p_kind: string
          p_locale: string
          p_model: string | null
          p_questions: Json
          p_source_question_set_id?: string | null
          p_topic_id?: string | null
        }
        Returns: string
      }
      get_ai_generation_usage_today: {
        Args: Record<PropertyKey, never>
        Returns: {
          used_count: number
          limit_count: number
        }[]
      }
      reserve_ai_generation: {
        Args: {
          p_action_id: string
          p_authorization: string
          p_document_id: string
          p_ip_digest: string
          p_issued_at: number
          p_key_version: number
          p_kind: string
          p_locale: string
          p_topic_id: string | null
          p_usage_date: string
        }
        Returns: {
          reservation_id: string
          used_count: number
          limit_count: number
        }[]
      }
      save_summary_version: {
        Args: {
          p_content: Json
          p_document_id: string
          p_locale: string
          p_model: string | null
          p_title: string
          p_topic_id?: string | null
        }
        Returns: string
      }
      review_flashcard: {
        Args: {
          p_flashcard_id: string
          p_rating: string
        }
        Returns: {
          ease_factor: number
          flashcard_id: string
          interval_days: number
          next_due_at: string
          rating: string
          repetitions: number
          reviewed_at: string
        }[]
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
