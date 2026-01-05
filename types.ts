
export interface PageResult {
  pageNumber: number;
  imageUrl: string;
  extractedText: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
}

export interface ProcessingStats {
  totalPages: number;
  processedPages: number;
  isProcessing: boolean;
}
