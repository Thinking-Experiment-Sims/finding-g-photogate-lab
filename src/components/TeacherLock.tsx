import { useState } from 'react';

/** Classroom deterrent only: the password ships in the page, so it keeps students out of the Linearize step, not determined users. */
export const TEACHER_PASSWORD = 'falcon';

export function TeacherLock({ teacher, onChange }: { teacher: boolean; onChange: (on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [wrong, setWrong] = useState(false);

  if (teacher) {
    return (
      <span>
        Teacher mode is on ·{' '}
        <button className="btn btn-quiet" onClick={() => onChange(false)}>
          Lock
        </button>
      </span>
    );
  }
  if (!open) {
    return (
      <button className="btn btn-quiet" onClick={() => setOpen(true)}>
        Teacher mode
      </button>
    );
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (text === TEACHER_PASSWORD) {
      setWrong(false);
      setText('');
      setOpen(false);
      onChange(true);
    } else {
      setWrong(true);
    }
  };
  return (
    <form onSubmit={submit} className="teacher-form">
      <label>
        Teacher password{' '}
        <input type="password" value={text} onChange={(e) => setText(e.target.value)} autoFocus autoComplete="off" aria-invalid={wrong} />
      </label>{' '}
      <button className="btn" type="submit">
        Unlock
      </button>{' '}
      <button className="btn btn-quiet" type="button" onClick={() => { setOpen(false); setWrong(false); setText(''); }}>
        Cancel
      </button>
      {wrong && <div className="field-msg" role="alert">That password is not right.</div>}
    </form>
  );
}
