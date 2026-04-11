import { Component, mount } from 'gea-embedded'
import './styles.css'

class App extends Component {
  template() {
    return (
      <div
        style={{
          width: 410,
          height: 502,
          backgroundColor: '#080C14',
          color: '#F8FAFC',
          fontFamily: 'Inter',
          fontSize: 15,
          padding: '22px 22px 34px 22px',
          overflow: 'scroll',
          gap: 18
        }}
      >
        <div style={{ marginBottom: 6 }}>
          <span style={{ fontFamily: 'Bebas Neue', fontSize: 54, color: '#FFFFFF' }}>Typography</span>
          <p style={{ marginBottom: 0 }}>
            A scrollable type specimen for the embedded renderer. The page uses
            {' '}
            <span style={{ color: '#64D2FF' }}>div</span>
            {', '}
            <span style={{ color: '#FBBF24' }}>span</span>
            {', '}
            <span style={{ color: '#A7F3D0' }}>p</span>
            {' and headings as the authoring vocabulary.'}
          </p>
        </div>

        <div style={{ borderWidth: 1, borderColor: '#273244', borderRadius: 12, padding: '14px', backgroundColor: '#101722', gap: 8 }}>
          <h1 style={{ fontFamily: 'Inter', marginBottom: 6 }}>Heading One</h1>
          <h2 style={{ fontFamily: 'Inter', marginBottom: 6 }}>Heading Two</h2>
          <h3 style={{ fontFamily: 'Inter', marginBottom: 6 }}>Heading Three</h3>
          <h4 style={{ fontFamily: 'Inter', marginBottom: 6 }}>Heading Four</h4>
          <h5 style={{ fontFamily: 'Inter', marginBottom: 6 }}>Heading Five</h5>
          <h6 style={{ fontFamily: 'Inter', marginBottom: 0 }}>Heading Six</h6>
        </div>

        <div style={{ gap: 8 }}>
          <span style={{ fontFamily: 'Bebas Neue', fontSize: 34, color: '#FBBF24' }}>Inter</span>
          <p>
            Inter is the steady interface voice: compact, neutral, and readable at small sizes.
            It keeps status text, settings labels, and dense controls calm without becoming invisible.
          </p>
          <p>
            The quick brown fox jumps over 13 lazy dogs while every pixel lands on the same baseline.
            <span style={{ color: '#93C5FD' }}> Inline emphasis</span>
            {' stays inside the paragraph flow.'}
          </p>
          <span style={{ fontFamily: 'Inter', fontSize: 28, color: '#E5E7EB' }}>Aa Bb Cc 12345</span>
          <span style={{ fontFamily: 'Inter', fontSize: 16, color: '#9CA3AF' }}>ABCDEFGHIJKLMNOPQRSTUVWXYZ</span>
        </div>

        <div style={{ gap: 8 }}>
          <span style={{ fontFamily: 'Bebas Neue', fontSize: 34, color: '#FB7185' }}>Oswald</span>
          <p style={{ fontFamily: 'Oswald', fontSize: 19 }}>
            Oswald has a condensed rhythm that feels useful for game scores, compact headlines,
            and anything that needs a bit of vertical confidence on a small screen.
          </p>
          <p style={{ fontFamily: 'Oswald', fontSize: 17 }}>
            Score 0248. Round 07. Battery 92 percent. Wi-Fi ready. Touch targets aligned.
          </p>
          <span style={{ fontFamily: 'Oswald', fontSize: 34, color: '#F8FAFC' }}>Aa Bb Cc 12345</span>
          <span style={{ fontFamily: 'Oswald', fontSize: 18, color: '#CBD5E1' }}>Sphinx of black quartz, judge my vow.</span>
        </div>

        <div style={{ gap: 8 }}>
          <span style={{ fontFamily: 'Bebas Neue', fontSize: 34, color: '#38BDF8' }}>Bebas Neue</span>
          <p style={{ fontFamily: 'Bebas Neue', fontSize: 24 }}>
            Bebas Neue is the poster voice: tall, bright, and direct. It works for app titles,
            big timers, scoreboards, and moments that should feel announced.
          </p>
          <p style={{ fontFamily: 'Bebas Neue', fontSize: 21 }}>
            READY PLAYER ONE. START. PAUSE. RESUME. CONNECTED. SIGNAL STRONG.
          </p>
          <span style={{ fontFamily: 'Bebas Neue', fontSize: 44, color: '#F8FAFC' }}>Aa Bb Cc 12345</span>
          <span style={{ fontFamily: 'Bebas Neue', fontSize: 22, color: '#BAE6FD' }}>PACK MY BOX WITH FIVE DOZEN LIQUOR JUGS</span>
        </div>

        <div style={{ gap: 8 }}>
          <span style={{ fontFamily: 'Bebas Neue', fontSize: 34, color: '#A7F3D0' }}>Cossette Texte</span>
          <p style={{ fontFamily: 'Cossette Texte', fontSize: 18 }}>
            Cossette Texte brings a warmer reading texture. It is friendly for longer passages,
            notes, instruction copy, and UI surfaces that should feel more editorial.
          </p>
          <p style={{ fontFamily: 'Cossette Texte', fontSize: 16 }}>
            Small screens still deserve rhythm. A clear paragraph, a measured line length,
            and a quiet color can make a tiny interface feel surprisingly spacious.
          </p>
          <span style={{ fontFamily: 'Cossette Texte', fontSize: 30, color: '#F8FAFC' }}>Aa Bb Cc 12345</span>
          <span style={{ fontFamily: 'Cossette Texte', fontSize: 17, color: '#D1FAE5' }}>Grumpy wizards make toxic brew for the jovial queen.</span>
        </div>

        <div style={{ borderWidth: 1, borderColor: '#374151', borderRadius: 12, padding: '14px', backgroundColor: '#111827', gap: 8 }}>
          <h2 style={{ fontFamily: 'Bebas Neue', marginBottom: 4, color: '#FFFFFF' }}>Mixed Composition</h2>
          <p style={{ fontFamily: 'Cossette Texte', fontSize: 17 }}>
            A paragraph can carry a
            {' '}
            <span style={{ fontFamily: 'Inter', color: '#64D2FF' }}>technical label</span>
            {', a '}
            <span style={{ fontFamily: 'Oswald', color: '#FBBF24' }}>score value</span>
            {', and a '}
            <span style={{ fontFamily: 'Bebas Neue', fontSize: 22, color: '#FB7185' }}>LOUD MOMENT</span>
            {' without leaving the block.'}
          </p>
          <p style={{ fontFamily: 'Inter', fontSize: 15, marginBottom: 0 }}>
            Scroll to inspect wrapping, inheritance, heading defaults, and inline spans across all four bundled fonts.
          </p>
        </div>
      </div>
    )
  }
}

mount(App)
