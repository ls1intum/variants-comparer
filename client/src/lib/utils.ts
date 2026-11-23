import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/*  Let the browser save data as a file  */
export function downloadFile(filename: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([ data ], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  /*  Delay revocation to ensure the download has started  */
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
