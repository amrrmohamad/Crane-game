const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://learning-platform-1euu.onrender.com/api/v1';

export interface Sentence {
  id: number;
  question: string; // The complete sentence
  words: string[]; // Array of words that make up the sentence
}

export interface QuestionsResponse {
  lessonId: number;
  lessonName: string;
  questions: Sentence[];
}

export interface GameSession {
  id: string;
  gameId: number;
  lessonId: number;
  childId: number;
  status: string;
  totalPoints: number;
  score: number;
  correctAnswers: number;
  wrongAnswers: number;
}

export interface CompletionResult {
  score: number;
  percentage: number;
  stars: number;
  coins: number;
  experience: number;
  session: GameSession;
  isNewReward: boolean;
}

export class GameAPI {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'API request failed' }));
      throw new Error(error.message || 'API request failed');
    }

    const data = await response.json();
    return data.data || data;
  }

  async getQuestions(gameId: number, lessonId?: number): Promise<QuestionsResponse> {
    const endpoint = lessonId 
      ? `/student-games/${gameId}/questions?lessonId=${lessonId}`
      : `/student-games/${gameId}/questions`;
    
    const data = await this.request(endpoint);
    
    // Transform backend questions to sentence format
    // For Crane Game: question = complete sentence, options = array of words
    const sentences: Sentence[] = data.questions.map((q: any) => ({
      id: q.id,
      question: q.question,
      words: q.options.map((opt: any) => 
        typeof opt === 'string' ? opt : opt.text
      )
    }));
    
    return {
      lessonId: data.lessonId,
      lessonName: data.lessonName,
      questions: sentences
    };
  }

  async startSession(gameId: number, lessonId?: number): Promise<GameSession> {
    const endpoint = lessonId 
      ? `/student-games/${gameId}/sessions?lessonId=${lessonId}`
      : `/student-games/${gameId}/sessions`;
    return this.request(endpoint, {
      method: 'POST',
    });
  }

  async completeSession(sessionId: string): Promise<CompletionResult> {
    return this.request(`/student-games/sessions/${sessionId}/complete`, {
      method: 'POST',
    });
  }
}

export const CRANE_GAME_ID = 5; // Crane Game ID
