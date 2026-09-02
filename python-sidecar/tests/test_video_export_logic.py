# -*- coding: utf-8 -*-
"""
Testes da lógica PURA de video_export.py (conversão beat->segundo, montagem
das tags de karaokê, agrupamento em linhas, quebra de linha, escape do ASS)
- sem ffmpeg, sem áudio e sem renderizar vídeo nenhum.

O módulo foi escrito com essa separação de propósito: build_ass() é
string-entra/string-sai, e só render_mp4() toca disco e chama subprocesso.
Assim o que pode dar errado silenciosamente (um tempo deslocado, uma sílaba
faltando) é testável em milissegundos.

Rodar:  python -m pytest tests/ -v   (ou python tests/test_video_export_logic.py)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.ultrastar_writer import Note, Song
from pipeline.video_export import (
    ass_escape,
    ass_time,
    beat_to_seconds,
    build_ass,
    group_lines,
    line_to_karaoke_text,
    notes_to_syllables,
    wrap_syllables,
    Syllable,
)


def _note(start, dur, text, singer=0) -> Note:
    return Note(start_beat=start, duration_beats=dur, pitch=0, text=text,
                note_type=":", singer=singer)


def _song(notes, breaks, bpm=240.0, gap_ms=0, duet=False) -> Song:
    return Song(title="T", artist="A", mp3_filename="a.mp3", bpm=bpm,
                gap_ms=gap_ms, notes=notes,
                phrase_breaks_after_index=breaks, duet=duet)


# ---------------------------------------------------------------------------
# Conversão de tempo
# ---------------------------------------------------------------------------

def test_beat_to_seconds_usa_a_formula_oficial():
    # A fórmula do formato é beat*60/(BPM*4) + GAP/1000. Com BPM 240 o beat
    # vale 60/(240*4) = 0,0625 s, então 16 beats = exatamente 1 segundo.
    assert beat_to_seconds(16, 240.0, 0) == 1.0
    assert beat_to_seconds(0, 240.0, 0) == 0.0


def test_beat_to_seconds_soma_o_gap():
    # O #GAP é o offset em MILISSEGUNDOS antes do beat 0 - some, não escale.
    assert beat_to_seconds(16, 240.0, 500) == 1.5


def test_beat_to_seconds_nao_multiplica_por_quatro_duas_vezes():
    """
    Guarda de regressão do bug histórico do projeto (ver beatgrid.py): o "*4"
    é do motor e vale UMA vez. Se alguém "corrigir" isto multiplicando de
    novo, a letra andaria 4x mais rápido que a música - o mesmo sintoma que
    já apareceu uma vez no .txt, e que num vídeo renderizado seria muito mais
    caro de descobrir (só olhando o mp4 pronto).
    """
    bpm = 123.05
    assert abs(beat_to_seconds(266, bpm, 0) - 266 * 60 / (bpm * 4)) < 1e-9
    assert beat_to_seconds(266, bpm, 0) > 30  # ~32,4 s; se fosse /4 daria ~8 s


def test_ass_time_formata_em_centesimos():
    assert ass_time(0) == "0:00:00.00"
    assert ass_time(1.5) == "0:00:01.50"
    assert ass_time(3661.25) == "1:01:01.25"
    assert ass_time(-5) == "0:00:00.00"  # nunca emite tempo negativo


# ---------------------------------------------------------------------------
# Agrupamento em linhas
# ---------------------------------------------------------------------------

def test_group_lines_usa_os_phrase_breaks():
    notes = [_note(0, 1, "a"), _note(1, 1, "b"), _note(2, 1, "c")]
    assert [len(l) for l in group_lines(_song(notes, [0]))] == [1, 2]


def test_group_lines_sem_breaks_devolve_uma_linha_so():
    notes = [_note(0, 1, "a"), _note(1, 1, "b")]
    assert len(group_lines(_song(notes, []))) == 1


def test_group_lines_nao_perde_a_ultima_linha():
    """A cauda depois do último "-" tem que virar linha, não sumir."""
    notes = [_note(0, 1, "a"), _note(1, 1, "b"), _note(2, 1, "c")]
    lines = group_lines(_song(notes, [0]))
    assert sum(len(l) for l in lines) == 3


# ---------------------------------------------------------------------------
# Sílabas e melisma
# ---------------------------------------------------------------------------

def test_notas_de_continuacao_nao_viram_texto():
    """
    "~" é notação de PITCH do UltraStar, não texto. Se virasse sílaba, uma
    palavra sustentada apareceria escrita "star~~~" na tela do vídeo.
    """
    notes = [_note(0, 16, "star "), _note(16, 16, "~"), _note(32, 16, "~")]
    syls = notes_to_syllables(notes, 240.0, 0)
    assert [s.text for s in syls] == ["star "]


def test_continuacao_estende_a_silaba_anterior():
    """O preenchimento tem que correr durante toda a sustentação."""
    notes = [_note(0, 16, "star "), _note(16, 16, "~")]
    syls = notes_to_syllables(notes, 240.0, 0)
    assert syls[0].start_s == 0.0
    assert syls[0].end_s == 2.0  # 32 beats a 240 BPM


def test_continuacao_orfa_no_inicio_e_descartada():
    """Um "~" sem nota anterior não tem o que estender - não pode explodir."""
    syls = notes_to_syllables([_note(0, 16, "~"), _note(16, 16, "ok")], 240.0, 0)
    assert [s.text for s in syls] == ["ok"]


# ---------------------------------------------------------------------------
# Tags de karaokê
# ---------------------------------------------------------------------------

def test_duracao_vai_ate_o_inicio_da_proxima_silaba():
    """
    Cada sílaba é preenchida até a PRÓXIMA começar, não até o próprio fim.
    Aqui a 1ª nota dura 1 s mas a 2ª só entra em 2 s: a tag tem que dizer
    200 centésimos, senão o preenchimento corre e trava parado 1 segundo.
    """
    syls = [Syllable("ab ", 0.0, 1.0), Syllable("cd", 2.0, 3.0)]
    assert "{\\kf200}ab " in line_to_karaoke_text(syls)


def test_ultima_silaba_usa_o_proprio_fim():
    syls = [Syllable("fim", 0.0, 1.0)]
    assert line_to_karaoke_text(syls) == "{\\kf100}fim"


def test_duracao_nunca_e_zero():
    """Uma sílaba muito curta ainda precisa de pelo menos 1 centésimo."""
    syls = [Syllable("x", 0.0, 0.001)]
    assert "{\\kf1}" in line_to_karaoke_text(syls)


def test_texto_vazio_nao_quebra():
    assert line_to_karaoke_text([]) == ""


# ---------------------------------------------------------------------------
# Escape
# ---------------------------------------------------------------------------

def test_escape_das_chaves_e_barras():
    """
    "{" abre bloco de tags no ASS: sem escape, a letra vira comando e SOME da
    tela sem erro nenhum. Modo de falha silencioso, por isso o teste.
    """
    assert ass_escape("a{b}c") == "a\\{b\\}c"
    assert ass_escape("a\\b") == "a\\\\b"


def test_acentos_passam_intactos():
    """Português é o idioma-alvo do projeto; acento não pode ser mexido."""
    assert ass_escape("coração") == "coração"


# ---------------------------------------------------------------------------
# Quebra de linha
# ---------------------------------------------------------------------------

def test_quebra_so_em_fronteira_de_palavra():
    """Partir "co-ra-ção" no meio da palavra ficaria pior que a linha larga."""
    syls = [Syllable("co", 0, 1), Syllable("ra", 1, 2), Syllable("ção ", 2, 3),
            Syllable("mi", 3, 4), Syllable("nha ", 4, 5)]
    for idx in wrap_syllables(syls, max_chars=6):
        assert syls[idx - 1].text.endswith(" ")


def test_linha_curta_nao_quebra():
    syls = [Syllable("oi ", 0, 1), Syllable("tu", 1, 2)]
    assert wrap_syllables(syls, max_chars=40) == []


def test_palavra_unica_gigante_nao_quebra_no_meio():
    """Sem espaço nenhum não há onde quebrar - melhor largo que picotado."""
    assert wrap_syllables([Syllable("a" * 80, 0, 1)], max_chars=10) == []


# ---------------------------------------------------------------------------
# Arquivo .ass completo
# ---------------------------------------------------------------------------

def _ass_of_two_lines(duet=False, singer2=0):
    notes = [_note(0, 8, "Oi "), _note(8, 8, "voce"),
             _note(160, 8, "tchau", singer=singer2)]
    return build_ass(_song(notes, [1], duet=duet))


def test_ass_tem_as_secoes_obrigatorias():
    ass = _ass_of_two_lines()
    for section in ("[Script Info]", "[V4+ Styles]", "[Events]"):
        assert section in ass


def test_ass_emite_um_dialogue_por_linha_cantada():
    ass = _ass_of_two_lines()
    principais = [l for l in ass.splitlines() if l.startswith("Dialogue:")
                  and ",Main," in l]
    assert len(principais) == 2


def test_ass_mostra_a_proxima_linha_como_previa():
    ass = _ass_of_two_lines()
    previas = [l for l in ass.splitlines() if ",Next," in l]
    # 1 prévia (a 2ª linha aparecendo embaixo durante a 1ª) + 1 contagem
    # regressiva (o intervalo até a 2ª linha passa de 4 s neste fixture).
    assert len(previas) == 2


def test_dueto_usa_estilo_proprio_para_o_segundo_cantor():
    ass = _ass_of_two_lines(duet=True, singer2=2)
    assert "Style: MainP2," in ass
    assert ",MainP2," in ass


def test_sem_dueto_nao_cria_estilo_do_p2():
    assert "MainP2" not in _ass_of_two_lines(duet=False)


def test_linha_nunca_aparece_antes_da_anterior_terminar():
    """
    O lead-in adianta a linha em ~2 s para dar tempo de ler. Em música rápida
    isso faria a linha nova nascer POR CIMA da anterior ainda na tela. O
    aparecimento é limitado pelo fim da anterior - este teste tranca isso.
    """
    # duas linhas coladas: a 2ª começa 0,5 s depois do fim da 1ª
    notes = [_note(0, 16, "um"), _note(24, 16, "dois")]
    ass = build_ass(_song(notes, [0]))
    starts = [l.split(",")[1] for l in ass.splitlines()
              if l.startswith("Dialogue:") and ",Main," in l]
    assert starts[1] >= "0:00:01.00"  # fim da 1ª linha, não 0:00:00.00


def test_musica_sem_notas_gera_ass_valido():
    """Vale ter cabeçalho e nenhum evento - não pode explodir."""
    ass = build_ass(_song([], []))
    assert "[Events]" in ass
    assert "Dialogue:" not in ass


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-v"]))
